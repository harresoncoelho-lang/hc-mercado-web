import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import inventory as inv


class InventoryGuards(unittest.TestCase):
    def test_manual_remote_guard_precedes_any_subprocess(self):
        with patch.dict(inv.os.environ, {}, clear=True), patch.object(inv.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "remote_actions_only"):
                inv.main()
            run.assert_not_called()

    def test_exact_package_and_tamper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {}
            for name in inv.ALLOWED - {"package-manifest.json"}:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture")
                files[name] = hashlib.sha256(b"fixture").hexdigest()
            (root / "package-manifest.json").write_text(json.dumps({"files": files}))
            with patch.object(inv, "DUMP_SHA", files[inv.DUMP]), patch.object(inv, "DUMP_BYTES", 7):
                inv.validate_package(root, list(inv.ALLOWED))
                with self.assertRaisesRegex(ValueError, "package_allowlist"):
                    inv.validate_package(root, list(inv.ALLOWED) + [".env"])
                (root / inv.DUMP).write_bytes(b"changed")
                with self.assertRaisesRegex(ValueError, "package_integrity"):
                    inv.validate_package(root, list(inv.ALLOWED))

    def test_private_and_manual_guards_precede_any_subprocess(self):
        with tempfile.TemporaryDirectory() as directory:
            event_path = Path(directory) / "event.json"
            environment = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_PATH": str(event_path),
                           "GITHUB_EVENT_NAME": "workflow_dispatch"}
            event_path.write_text(json.dumps({"repository": {"private": False}}))
            with patch.dict(inv.os.environ, environment, clear=True), patch.object(inv.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "private_repository_required"):
                    inv.main()
                run.assert_not_called()
            event_path.write_text(json.dumps({"repository": {"private": True}}))
            environment["GITHUB_EVENT_NAME"] = "push"
            with patch.dict(inv.os.environ, environment, clear=True), patch.object(inv.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "manual_dispatch_required"):
                    inv.main()
                run.assert_not_called()

    def test_container_configuration_fails_closed(self):
        args = ["--list", "/input/ficticio.dump"]
        input_dir, empty_pgdata = "/repo/input", "/repo/empty-pgdata"
        data = {"HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True, "Privileged": False,
                               "CapDrop": ["ALL"], "SecurityOpt": ["no-new-privileges"]},
                "Config": {"User": "65534:65534", "Entrypoint": ["pg_restore"], "Cmd": args},
                "Mounts": [{"Type": "bind", "Source": input_dir, "Destination": "/input", "RW": False},
                           {"Type": "bind", "Source": empty_pgdata, "Destination": "/var/lib/postgresql/data", "RW": False}]}
        inv.validate_container(data, args, input_dir, empty_pgdata)
        for key, value in [("NetworkMode", "bridge"), ("ReadonlyRootfs", False), ("Privileged", True)]:
            altered = copy.deepcopy(data)
            altered["HostConfig"][key] = value
            with self.assertRaisesRegex(ValueError, "container_isolation"):
                inv.validate_container(altered, args, input_dir, empty_pgdata)
        for index in (0, 1):
            for key, value in [("RW", True), ("Type", "volume"), ("Source", "/unexpected"), ("Destination", "/unexpected")]:
                altered = copy.deepcopy(data)
                altered["Mounts"][index][key] = value
                with self.assertRaisesRegex(ValueError, "container_isolation"):
                    inv.validate_container(altered, args, input_dir, empty_pgdata)
        altered = copy.deepcopy(data)
        altered["Mounts"].append({"Type": "volume", "Source": "/anonymous", "Destination": "/other", "RW": True})
        with self.assertRaisesRegex(ValueError, "container_isolation"):
            inv.validate_container(altered, args, input_dir, empty_pgdata)

    def test_command_never_connects_or_skips_acl(self):
        args = ["--schema-only", "--file=-", "/input/ficticio.dump"]
        command = inv.create_command("/tmp/input", "/tmp/empty-pgdata", args)
        self.assertIn("none", command)
        self.assertIn("pg_restore", command)
        self.assertIn(inv.IMAGE, command)
        self.assertIn("type=bind,src=/tmp/empty-pgdata,dst=/var/lib/postgresql/data,readonly", command)
        self.assertTrue(command[-3:] == args)
        for flag in ("--dbname", "--clean", "--no-owner", "--no-acl", "--no-comments"):
            self.assertNotIn(flag, command)

    def test_toc_counts_entries_not_header(self):
        self.assertEqual(len(inv.toc_entries("; TOC Entries: 812\n1; 0 0 EXTENSION - plpgsql\n2; 0 0 ACL public x\n")), 2)

    def test_only_numeric_version_from_expected_header_is_reported(self):
        text = "; Dumped from database version: 17.11 (vendor text)\nCREATE FUNCTION hidden_secret();\n"
        self.assertEqual(inv.header_version(text, "Dumped from database version"), "17.11")
        self.assertIsNone(inv.header_version("CREATE FUNCTION 17.11();", "Dumped from database version"))

    def test_report_survives_failures_without_exposing_sql(self):
        cases = [("17.11", "17.11", "17.11", 812, None),
                 ("17.11", "17.6", "17.11", 812, "source_version"),
                 ("17.11", "17.11", "17.6", 812, "pg_dump_version"),
                 ("17.6", "17.11", "17.11", 812, "client_version"),
                 ("17.11", "17.11", "17.11", 811, "toc_count_changed"),
                 ("17.11", "17.11", "17.11", 812, "schema_extraction")]
        for client, source, dumper, count, failure in cases:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                event_path = root / "event.json"
                event_path.write_text(json.dumps({"repository": {"private": True}}))
                environment = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_PATH": str(event_path),
                               "GITHUB_EVENT_NAME": "workflow_dispatch"}

                def fake_extract(input_dir, empty_pgdata, args, destination):
                    if destination.name == "version.txt":
                        destination.write_text(f"pg_restore (PostgreSQL) {client}\n")
                    elif destination.name == "toc.list":
                        header = f"; Dumped from database version: {source}\n; Dumped by pg_dump version: {dumper}\n"
                        destination.write_text(header + "\n".join(f"{i}; 0 0 TABLE public example" for i in range(1, count + 1)))
                    else:
                        destination.write_text("CREATE FUNCTION hidden_secret();\n")
                        if failure == "schema_extraction":
                            raise ValueError("schema_extraction")
                    return {"exit_code": 0, "network": "none"}

                git_result = SimpleNamespace(stdout="\0".join(inv.ALLOWED) + "\0")
                with patch.dict(inv.os.environ, environment, clear=True), patch.object(inv, "ROOT", root), \
                        patch.object(inv, "validate_package"), patch.object(inv, "docker") as docker, \
                        patch.object(inv.subprocess, "run", return_value=git_result), \
                        patch.object(inv, "extract", side_effect=fake_extract), patch("builtins.print"):
                    if failure:
                        with self.assertRaisesRegex(ValueError, failure):
                            inv.main()
                    else:
                        inv.main()
                    docker.assert_called_once()
                report_text = (root / "evidence/report.json").read_text()
                report = json.loads(report_text)
                self.assertNotIn("hidden_secret", report_text)
                self.assertFalse(report["restoration_executed"])
                self.assertEqual(report["status"], "failed" if failure else "inventory_complete")
                if failure:
                    self.assertEqual(report["category"], failure)
                for name, proof in report["outputs"].items():
                    self.assertEqual(proof["sha256"], inv.sha256(root / "evidence" / name))
                if failure in ("source_version", "pg_dump_version", "toc_count_changed"):
                    self.assertFalse((root / "evidence/schema.sql").exists())
                if failure == "schema_extraction":
                    self.assertIn("schema.sql", report["outputs"])


if __name__ == "__main__":
    unittest.main()
