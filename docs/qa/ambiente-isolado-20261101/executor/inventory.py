"""Inventory only: never starts PostgreSQL or executes the extracted SQL."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
IMAGE = "postgres:17.11-bookworm@sha256:2cd2c0f809604aaeff6f0ec8f40aecbd025613107561015c69369a1a7f1d3416"
EXPECTED_VERSION = "17.11"
DUMP = "input/ficticio.dump"
DUMP_SHA = "30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c"
DUMP_BYTES = 505274
ALLOWED = {".github/workflows/inventario.yml", "inventory.py", "test_inventory.py", "README.md", "package-manifest.json", DUMP}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_package(root, tracked):
    if set(tracked) != ALLOWED:
        raise ValueError("package_allowlist")
    manifest = json.loads((root / "package-manifest.json").read_text(encoding="utf-8"))
    if set(manifest["files"]) != ALLOWED - {"package-manifest.json"}:
        raise ValueError("manifest_allowlist")
    for name, expected in manifest["files"].items():
        path = root / name
        if path.is_symlink() or not path.is_file() or sha256(path) != expected:
            raise ValueError("package_integrity")
    dump = root / DUMP
    if dump.stat().st_size != DUMP_BYTES or sha256(dump) != DUMP_SHA:
        raise ValueError("dump_identity")


def create_command(input_dir, empty_pgdata, args):
    return ["docker", "create", "--platform", "linux/amd64", "--network", "none",
            "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--pids-limit", "64", "--memory", "256m", "--cpus", "1", "--ipc", "none",
            "--user", "65534:65534", "--mount", f"type=bind,src={input_dir},dst=/input,readonly",
            "--mount", f"type=bind,src={empty_pgdata},dst=/var/lib/postgresql/data,readonly",
            "--entrypoint", "pg_restore", IMAGE, *args]


def validate_container(data, args, input_dir, empty_pgdata):
    host, config, mounts = data["HostConfig"], data["Config"], data["Mounts"]
    expected = {"/input": str(input_dir), "/var/lib/postgresql/data": str(empty_pgdata)}
    actual = {mount["Destination"]: mount for mount in mounts}
    mounts_valid = (len(mounts) == 2 and set(actual) == set(expected)
                    and all(actual[dest]["Type"] == "bind" and not actual[dest]["RW"]
                            and actual[dest]["Source"] == source for dest, source in expected.items()))
    valid = (host["NetworkMode"] == "none" and host["ReadonlyRootfs"]
             and not host["Privileged"] and host["CapDrop"] == ["ALL"]
             and "no-new-privileges" in host["SecurityOpt"]
             and config["User"] == "65534:65534"
             and config["Entrypoint"] == ["pg_restore"] and config["Cmd"] == args
             and mounts_valid)
    if not valid:
        raise ValueError("container_isolation")


def docker(args, **kwargs):
    return subprocess.run(["docker", *args], check=True, stderr=subprocess.PIPE, timeout=90, **kwargs)


def extract(input_dir, empty_pgdata, args, destination):
    created = subprocess.run(create_command(input_dir, empty_pgdata, args), check=True,
                             capture_output=True, text=True, timeout=30)
    container_id = created.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{64}", container_id):
        raise ValueError("container_identity")
    started = time.monotonic()
    try:
        before = json.loads(docker(["inspect", container_id], capture_output=False,
                                   stdout=subprocess.PIPE, text=True).stdout)[0]
        validate_container(before, args, input_dir, empty_pgdata)
        with destination.open("xb") as output:
            docker(["start", "--attach", container_id], stdout=output)
        after = json.loads(docker(["inspect", container_id], stdout=subprocess.PIPE, text=True).stdout)[0]
        if after["State"]["Running"] or after["State"]["ExitCode"] != 0:
            raise ValueError("container_exit")
        return {"network": "none", "root_read_only": True, "input_read_only": True,
                "pgdata_empty_bind_read_only": True,
                "entrypoint": "pg_restore", "exit_code": 0,
                "duration_seconds": round(time.monotonic() - started, 3)}
    finally:
        docker(["rm", "--force", container_id], stdout=subprocess.DEVNULL)


def toc_entries(text):
    return [line for line in text.splitlines() if re.match(r"^\d+;\s", line)]


def error_category(error):
    return str(error) if isinstance(error, ValueError) and re.fullmatch(r"[a-z_]+", str(error)) else type(error).__name__


def header_version(text, label):
    match = re.search(r"^;[ \t]*" + re.escape(label) + r":[ \t]*(\d+(?:\.\d+){1,2})(?:\s|$)", text, re.MULTILINE)
    return match.group(1) if match else None


def save_report(output, report):
    report["outputs"] = {name: {"sha256": sha256(output / name), "bytes": (output / name).stat().st_size}
                         for name in ("version.txt", "toc.list", "schema.sql") if (output / name).is_file()}
    if (output / "version.txt").is_file():
        version = (output / "version.txt").read_text(encoding="utf-8", errors="replace")
        match = re.fullmatch(r"pg_restore \(PostgreSQL\) (\d+(?:\.\d+){1,2})(?:\s+\([^\r\n]+\))?\s*", version)
        report["observed_client_version"] = match.group(1) if match else None
    if (output / "toc.list").is_file():
        toc = (output / "toc.list").read_text(encoding="utf-8", errors="replace")
        report["observed_source_version"] = header_version(toc, "Dumped from database version")
        report["observed_pg_dump_version"] = header_version(toc, "Dumped by pg_dump version")
        report["toc_entries"] = len(toc_entries(toc))
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("remote_actions_only")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    if event.get("repository", {}).get("private") is not True:
        raise ValueError("private_repository_required")
    if os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        raise ValueError("manual_dispatch_required")
    tracked = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True,
                             capture_output=True, text=True).stdout.rstrip("\0").split("\0")
    validate_package(ROOT, tracked)
    output = ROOT / "evidence"
    output.mkdir(exist_ok=False)
    report = {"scope": "inventory_only_no_database_no_sql_execution", "status": "running", "phase": "prepare",
              "source_sha256": DUMP_SHA, "source_bytes": DUMP_BYTES,
              "image": IMAGE, "expected_version": EXPECTED_VERSION, "executions": {},
              "schema_filtering": "schema-only; comments, ownership and ACL retained",
              "restoration_executed": False,
              "limitations": ["No database started", "No data restoration or ACL/role reconciliation",
                              "No Storage bytes restored", "Not production recovery or capacity proof"]}
    save_report(output, report)
    try:
        # Override the image's declared VOLUME; otherwise Docker creates an anonymous writable volume.
        empty_pgdata = ROOT / "empty-pgdata"
        empty_pgdata.mkdir(exist_ok=False)
        report["phase"] = "image_pull"
        save_report(output, report)
        docker(["pull", "--platform", "linux/amd64", IMAGE], stdout=subprocess.DEVNULL)
        commands = [("version.txt", ["--version"]),
                    ("toc.list", ["--list", "/input/ficticio.dump"]),
                    ("schema.sql", ["--schema-only", "--file=-", "/input/ficticio.dump"])]
        for filename, args in commands:
            report["phase"] = filename
            save_report(output, report)
            report["executions"][filename] = extract((ROOT / "input").resolve(), empty_pgdata.resolve(), args, output / filename)
            save_report(output, report)
            if filename == "version.txt" and report["observed_client_version"] != EXPECTED_VERSION:
                raise ValueError("client_version")
            if filename == "toc.list":
                if report["toc_entries"] != 812:
                    raise ValueError("toc_count_changed")
                if report["observed_source_version"] != EXPECTED_VERSION:
                    raise ValueError("source_version")
                if report["observed_pg_dump_version"] != EXPECTED_VERSION:
                    raise ValueError("pg_dump_version")
        report["status"] = "inventory_complete"
        report["phase"] = "complete"
    except Exception as error:
        report["status"] = "failed"
        report["category"] = error_category(error)
        raise
    finally:
        save_report(output, report)
    print(json.dumps({"status": "inventory_complete", "toc_entries": report["toc_entries"],
                      "source_sha256": DUMP_SHA, "restoration_executed": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Child process output may contain schema details. Never print it into the job log.
        category = error_category(error)
        print(json.dumps({"status": "failed", "category": category, "restoration_executed": False}))
        sys.exit(1)
