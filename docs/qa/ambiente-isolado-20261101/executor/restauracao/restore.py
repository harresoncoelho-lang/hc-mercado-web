"""One empty, network-contained PostgreSQL restore. No Auth/Storage HTTP services."""
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.004@sha256:e85bc10ac5b141223b289e1e8dc8d448cf3df92501917149db0366b9c5aaf053"
DUMP_SHA = "30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c"
BASELINE_SHA = "43b87aceb61497dd9f1f28ac8538d7d4e93752f8415c60ea47f3100dca0485e0"
MANIFEST_SHA = "0ef9542dc690dda39184e4dd9e23cef6ebc4bc1b4bb300e89d183e2c6a864994"
DB = "licitaplena_restore"
START = """initdb -D /qa/data -U supabase_admin --auth-local=trust --auth-host=reject --locale-provider=icu --icu-locale=en_US.UTF-8 --encoding=UTF8 --no-instructions > /qa/initdb.log 2>&1 || { cat /qa/initdb.log >&2; exit 1; }
exec postgres -D /qa/data -c listen_addresses='' -c unix_socket_directories=/qa -c shared_preload_libraries='' -c logging_collector=off"""
NEW_FILES = {".github/workflows/restauracao.yml", "restauracao/restore.py", "restauracao/test_restore.py", "restauracao/README.md", "restauracao/baseline.json"}
LIBRARY_PATH_PROBE = """pglib="$(pg_config --pkglibdir)"
printf 'pg_config_pkglibdir=%s\\n' "$pglib"
for directory in "$pglib" /nix/var/nix/profiles/default/lib; do
  for library in supautils safeupdate; do
    file="$directory/$library.so"
    if test -r "$file"; then readable=true; else readable=false; fi
    printf 'library=%s path=%s readable=%s\\n' "$library" "$file" "$readable"
  done
done"""


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ident(value):
    if not re.fullmatch(r"[a-z_][a-z_0-9]*", value):
        raise ValueError("identifier")
    return '"' + value + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def role_sql(baseline):
    lines = ["BEGIN; SET standard_conforming_strings=on;"]
    options = {"rolsuper": "SUPERUSER", "rolinherit": "INHERIT", "rolcanlogin": "LOGIN",
               "rolcreatedb": "CREATEDB", "rolbypassrls": "BYPASSRLS", "rolcreaterole": "CREATEROLE", "rolreplication": "REPLICATION"}
    for role in baseline["roles"]:
        name = role["rolname"]
        if name.startswith("pg_"):
            continue
        action = "ALTER" if name == "supabase_admin" else "CREATE"
        attrs = " ".join(word if role[key] else "NO" + word for key, word in options.items())
        lines.append(f"{action} ROLE {ident(name)} WITH {attrs} CONNECTION LIMIT {int(role['rolconnlimit'])};")
        if role["rolvaliduntil"] is not None:
            lines.append(f"ALTER ROLE {ident(name)} VALID UNTIL {literal(role['rolvaliduntil'])};")
        for setting in role["rolconfig"]:
            key, value = setting.split("=", 1)
            if key in ("search_path", "session_preload_libraries"):
                # These GUC_LIST_QUOTE values need separate items, including the source's backslash.
                parts = next(csv.reader([value], skipinitialspace=True))
                value_sql = ", ".join(literal(part) for part in parts)
            else:
                value_sql = literal(value)
            lines.append(f"ALTER ROLE {ident(name)} SET {ident(key)} TO {value_sql};")
    for membership in baseline["memberships"]:
        if membership["grantor"] != "supabase_admin":
            raise ValueError("unexpected_membership_grantor")
        flags = ", ".join(f"{name.upper()} {'TRUE' if membership[name] else 'FALSE'}" for name in ("admin", "inherit", "set"))
        lines.append(f"GRANT {ident(membership['role'])} TO {ident(membership['member'])} WITH {flags} GRANTED BY supabase_admin;")
    lines.append("COMMIT;")
    return "\n".join(lines)


def canonical_default_acl(key, body):
    if key[1] != "DEFAULT ACL":
        return body
    lines = body.splitlines()
    pattern = (r"ALTER DEFAULT PRIVILEGES FOR ROLE ([a-z_][a-z_0-9]*) IN SCHEMA ([a-z_][a-z_0-9]*) "
               r"GRANT ALL ON (FUNCTIONS|SEQUENCES|TABLES) TO ([a-z_][a-z_0-9]*);")
    grants = [re.fullmatch(pattern, line) for line in lines]
    if not grants or not all(grants):
        return body
    if any((f"DEFAULT PRIVILEGES FOR {g[3]}", "DEFAULT ACL", g[2], g[1]) != key for g in grants):
        return body
    if len({g[4] for g in grants}) != len(grants):
        return body
    # Independent positive grants commute; every other SQL section stays literal.
    return "\n".join(sorted(lines))


def canonical_schema(text):
    """Compare pg_dump sections; retain all SQL, owners, ACLs, comments and function bodies."""
    chunks = re.split(r"(?m)^--\n-- Name: (.*); Type: (.*); Schema: (.*); Owner: (.*)\n--\n", text.replace("\r\n", "\n"))
    if len(chunks) < 6:
        raise ValueError("schema_sections_missing")
    result = {}
    for offset in range(1, len(chunks), 5):
        key = tuple(chunks[offset:offset + 4])
        body = chunks[offset + 4]
        body = body.split("\n--\n-- PostgreSQL database dump complete\n--", 1)[0]
        body = re.sub(r"(?m)^\\(?:un)?restrict [a-zA-Z0-9]+\s*$", "", body).strip()
        if key in result:
            raise ValueError("duplicate_schema_section")
        body = canonical_default_acl(key, body)
        result[key] = hashlib.sha256(body.encode()).hexdigest()
    return result


def normalize_globals(data):
    for role in data["roles"]:
        role["rolconfig"] = sorted(role["rolconfig"] or [])
    for acl in data["default_acl"]:
        acl["acl"] = sorted(acl["acl"] or [])
    data["roles"].sort(key=lambda r: r["rolname"])
    data["memberships"].sort(key=lambda m: (m["role"], m["member"], m["grantor"]))
    data["default_acl"].sort(key=lambda a: (a["owner"], a["schema"] or "", a["kind"]))
    return data


def normalize_kit(value):
    value = json.loads(json.dumps(value))
    for item in [value["table"], *value["functions"]]:
        item["acl"] = sorted(next(csv.reader([item["acl"][1:-1]]))) if item["acl"] else []
    value["functions"].sort(key=lambda item: item["object"])
    return value


def create_command(input_dir):
    return ["docker", "create", "--platform", "linux/amd64", "--network", "none", "--read-only",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "postgres", "--no-healthcheck",
            "--pids-limit", "256", "--memory", "1g", "--cpus", "1",
            "--tmpfs", "/qa:rw,nosuid,noexec,size=512m,mode=1777", "--tmpfs", "/tmp:rw,nosuid,noexec,size=64m,mode=1777",
            "--mount", f"type=bind,src={input_dir},dst=/input,readonly",
            "--entrypoint", "/bin/bash", IMAGE, "-ceu", START]


def verify_container(data, input_dir):
    host, config, mounts = data["HostConfig"], data["Config"], data["Mounts"]
    valid = (host["NetworkMode"] == "none" and host["ReadonlyRootfs"] and not host["Privileged"]
             and host["CapDrop"] == ["ALL"] and "no-new-privileges" in host["SecurityOpt"]
             and config["User"] == "postgres" and config["Entrypoint"] == ["/bin/bash"]
             and config["Cmd"] == ["-ceu", START] and not host.get("PortBindings")
             and host["Tmpfs"] == {"/qa": "rw,nosuid,noexec,size=512m,mode=1777", "/tmp": "rw,nosuid,noexec,size=64m,mode=1777"}
             and len(mounts) == 1 and mounts[0]["Type"] == "bind" and not mounts[0]["RW"]
             and mounts[0]["Source"] == str(input_dir) and mounts[0]["Destination"] == "/input")
    if not valid:
        raise ValueError("container_isolation")


def run_captured(args, output, data=None, filename=None, check=True, timeout=120, limit=None, failure_filename="command-failure.txt"):
    def preserve(name, stdout, stderr, timed_out=False):
        stdout = stdout.encode() if isinstance(stdout, str) else stdout or b""
        stderr = stderr.encode() if isinstance(stderr, str) else stderr or b""
        saved_stdout = stdout[-limit:] if limit else stdout
        saved_stderr = stderr[-limit:] if limit else stderr
        (output / name).write_bytes(saved_stdout)
        if saved_stderr:
            (output / (name + ".stderr")).write_bytes(saved_stderr)
        if timed_out or limit:
            (output / (name + ".capture.json")).write_text(json.dumps({"partial_timeout": timed_out,
                "timeout_seconds": timeout, "stdout_bytes_observed": len(stdout), "stderr_bytes_observed": len(stderr),
                "stdout_bytes_saved": len(saved_stdout), "stderr_bytes_saved": len(saved_stderr), "tail_limit_bytes": limit}))
    try:
        result = subprocess.run(args, input=data.encode() if data is not None else None,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        preserve(filename or failure_filename, error.stdout, error.stderr, timed_out=True)
        raise
    if filename or (check and result.returncode):
        preserve(filename or failure_filename, result.stdout, result.stderr)
    if check and result.returncode:
        raise ValueError("subprocess_exit")
    return result


def capture_diagnostics(container, output):
    captures = ["docker", "initdb"]
    commands = [["docker", "logs", "--tail", "100", container],
                ["docker", "exec", container, "/bin/sh", "-c", "if test -f /qa/initdb.log; then tail -c 65536 /qa/initdb.log; fi"]]
    results = {}
    for name, args in zip(captures, commands):
        try:
            result = run_captured(args, output, filename=f"diagnostic-{name}.txt", check=False, timeout=10, limit=65536)
            results[name] = {"exit_code": result.returncode, "tail_limit_bytes_per_stream": 65536}
        except Exception as error:
            results[name] = {"error": type(error).__name__, "tail_limit_bytes_per_stream": 65536}
    return results


def load_library(container, library, command):
    if library not in ("supautils", "safeupdate"):
        raise ValueError("library_allowlist")
    marker = library + "_loaded"
    args = ["docker", "exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
            "-h", "/qa", "-U", "supabase_admin", "-d", "postgres"]
    result = command(args, data=f"LOAD {literal(library)}; SELECT {literal(marker)};",
                     filename=f"library-{library}.txt", check=False)
    return {"exit_code": result.returncode,
            "loaded": result.returncode == 0 and result.stdout.decode().strip() == marker}


GLOBALS_SQL = """SELECT json_build_object(
'roles',(SELECT json_agg(to_jsonb(r)-'oid'-'rolpassword') FROM pg_roles r),
'memberships',(SELECT json_agg(json_build_object('role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),'grantor',pg_get_userbyid(m.grantor),'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option)) FROM pg_auth_members m),
'default_acl',(SELECT json_agg(json_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'kind',d.defaclobjtype,'acl',d.defaclacl::text[])) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace));"""
KIT_SQL = """SELECT json_build_object(
'table',(SELECT json_build_object('object','public.operacao_kit_documentos','owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity) FROM pg_class c WHERE c.oid='public.operacao_kit_documentos'::regclass),
'functions',(SELECT json_agg(json_build_object('object',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('gravar_kit_documento','kit_documento_escopo_imutavel')));"""


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        raise ValueError("remote_manual_only")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    if event.get("repository", {}).get("private") is not True:
        raise ValueError("private_repository")
    tracked = set(subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT, text=True).rstrip("\0").split("\0"))
    manifest = ROOT / "package-manifest.json"
    if digest(manifest) != MANIFEST_SHA:
        raise ValueError("inventory_manifest")
    old_files = json.loads(manifest.read_text())["files"]
    if tracked != set(old_files) | {"package-manifest.json"} | NEW_FILES:
        raise ValueError("file_allowlist")
    for name, expected in old_files.items():
        if (ROOT / name).is_symlink() or digest(ROOT / name) != expected:
            raise ValueError("source_integrity")
    baseline_path = ROOT / "restauracao/baseline.json"
    if digest(baseline_path) != BASELINE_SHA or (ROOT / "input/ficticio.dump").stat().st_size != 505274:
        raise ValueError("baseline_integrity")
    baseline = json.loads(baseline_path.read_text())
    output = ROOT / "evidence-restore"
    output.mkdir(exist_ok=False)
    report = {"status": "running", "phase": "image_pull", "image": IMAGE, "dump_sha256": DUMP_SHA,
              "baseline_sha256": BASELINE_SHA, "restore_attempted": False, "restore_completed": False, "role_passwords_copied": False,
              "auth_http_tested": False, "storage_bytes_restored": False, "checks": {}, "limitations": baseline["limitations"]}
    container = None
    sql_counter = 0
    started = time.monotonic()

    def save():
        report["duration_seconds"] = round(time.monotonic() - started, 3)
        report["files"] = {p.name: {"sha256": digest(p), "bytes": p.stat().st_size} for p in output.iterdir() if p.name != "report.json"}
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")

    def command(args, data=None, filename=None, check=True, timeout=120, limit=None):
        return run_captured(args, output, data, filename, check, timeout, limit, failure_filename=f"failure-{report['phase']}.txt")

    def sql(query, db=DB, user="supabase_admin"):
        nonlocal sql_counter
        sql_counter += 1
        args = ["docker", "exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "/qa", "-U", user, "-d", db]
        return command(args, query, f"sql-{sql_counter:02d}.txt").stdout.decode().strip()

    try:
        save()
        command(["docker", "pull", "--platform", "linux/amd64", IMAGE])
        report["phase"] = "container_create"
        save()
        container = command(create_command((ROOT / "input").resolve())).stdout.decode().strip()
        if not re.fullmatch(r"[0-9a-f]{64}", container):
            container = None
            raise ValueError("container_identity")
        report["phase"] = "container_isolation"
        save()
        inspect = json.loads(command(["docker", "inspect", container]).stdout)[0]
        verify_container(inspect, (ROOT / "input").resolve())
        report["isolation"] = {"network": "none", "root_read_only": True, "input_read_only": True, "writable_ephemeral_tmpfs": ["/qa", "/tmp"], "ports": []}
        report["phase"] = "server_start"
        save()
        command(["docker", "start", container])
        report["phase"] = "server_readiness"
        save()
        for _ in range(60):
            ready = command(["docker", "exec", container, "pg_isready", "-h", "/qa", "-U", "supabase_admin", "-d", "postgres"], check=False)
            if ready.returncode == 0:
                break
            if not json.loads(command(["docker", "inspect", container]).stdout)[0]["State"]["Running"]:
                raise ValueError("server_start")
            time.sleep(1)
        else:
            raise ValueError("server_timeout")
        report["phase"] = "preflight"
        version = sql("SHOW server_version;", "postgres")
        report["server_version"] = version
        if not re.match(r"^17\.11(?:\s|$)", version):
            raise ValueError("server_version")
        report["phase"] = "library_paths"
        save()
        command(["docker", "exec", container, "/bin/bash", "-ceu", LIBRARY_PATH_PROBE], filename="library-paths.txt", limit=4096)
        report["library_preflight"] = {}
        for library in ("supautils", "safeupdate"):
            report["phase"] = "load_" + library
            save()
            proof = load_library(container, library, command)
            report["library_preflight"][library] = proof
            save()
            if not proof["loaded"]:
                raise ValueError("library_load")
        report["phase"] = "preflight_pg_trgm"
        save()
        if sql("SELECT count(*) FROM pg_available_extensions WHERE name='pg_trgm';", "postgres") != "1":
            raise ValueError("pg_trgm_missing")
        source_schema = command(["docker", "exec", container, "pg_restore", "--schema-only", "--file=-", "/input/ficticio.dump"], filename="source-schema.sql").stdout.decode()
        source_sections = canonical_schema(source_schema)
        report["phase"] = "roles_and_empty_database"
        save()
        sql(role_sql(baseline), "postgres")
        sql(f"CREATE DATABASE {ident(DB)} OWNER supabase_admin TEMPLATE template0;", "postgres")
        report["phase"] = "restore"
        report["restore_attempted"] = True
        save()
        restore_start = time.monotonic()
        command(["docker", "exec", container, "pg_restore", "--exit-on-error", "--single-transaction", "--host=/qa", "--username=supabase_admin", "--dbname=" + DB, "/input/ficticio.dump"], filename="restore.txt")
        report["restore_seconds"] = round(time.monotonic() - restore_start, 3)
        report["restore_completed"] = True
        report["phase"] = "compare"
        save()
        restored_schema = command(["docker", "exec", container, "pg_dump", "--schema-only", "--host=/qa", "--username=supabase_admin", "--dbname=" + DB], filename="restored-schema.sql").stdout.decode()
        restored_sections = canonical_schema(restored_schema)
        report["schema_sections"] = {"source": len(source_sections), "restored": len(restored_sections)}
        report["checks"]["schema_sections_equal"] = source_sections == restored_sections
        mismatches = [" | ".join(k) for k in set(source_sections) | set(restored_sections) if source_sections.get(k) != restored_sections.get(k)]
        (output / "schema-mismatches.json").write_text(json.dumps(sorted(mismatches), indent=2))
        table_parts = []
        for name in baseline["tables"]:
            schema, table = name.split(".")
            table_parts.extend([literal(name), f"(SELECT json_build_object('count',count(*),'rows_md5',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM {ident(schema)}.{ident(table)} t)"])
        actual_tables = json.loads(sql("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public; SELECT json_build_object(" + ",".join(table_parts) + "); COMMIT;"))
        (output / "tables.json").write_text(json.dumps(actual_tables, indent=2))
        report["checks"]["tables_40_equal"] = actual_tables == baseline["tables"]
        globals_actual = normalize_globals(json.loads(sql("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public;" + GLOBALS_SQL + "COMMIT;")))
        (output / "globals.json").write_text(json.dumps(globals_actual, indent=2))
        for key in ("roles", "memberships", "default_acl"):
            report["checks"][key + "_equal"] = globals_actual[key] == baseline[key]
        kit = json.loads(sql("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public;" + KIT_SQL + "COMMIT;"))
        (output / "kit-acl.json").write_text(json.dumps(kit, indent=2))
        report["checks"]["kit_pre_correction_acl_equal"] = normalize_kit(kit) == normalize_kit(baseline["kit_acl"])
        report["checks"]["authenticator_library_session"] = sql("SELECT current_user;", user="authenticator") == "authenticator"
        if not all(report["checks"].values()):
            raise ValueError("baseline_comparison")
        report["status"] = "restored_and_compared_for_documented_scope"
        report["phase"] = "complete"
    except Exception as error:
        report["status"] = "failed"
        report["category"] = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[a-z_]+", str(error)) else type(error).__name__
        raise
    finally:
        if container:
            # initdb failure is echoed before exit because a stopped container loses its tmpfs.
            report["diagnostics"] = capture_diagnostics(container, output)
            try:
                result = command(["docker", "rm", "--force", container], check=False)
                report["container_removed"] = result.returncode == 0
            except Exception as error:
                report["container_removed"] = False
                report["cleanup_error"] = type(error).__name__
            if not report["container_removed"]:
                report["status"] = "failed"
                report["cleanup_error"] = report.get("cleanup_error", "container_cleanup")
        save()
    if container and not report["container_removed"]:
        raise ValueError("container_cleanup")
    print(json.dumps({"status": report["status"], "checks": report["checks"], "restore_seconds": report["restore_seconds"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"status": "failed", "details": "private evidence-restore/report.json"}))
        sys.exit(1)
