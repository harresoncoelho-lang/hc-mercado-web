import copy
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import restore as r


class RestoreGuards(unittest.TestCase):
    def test_local_execution_rejected_before_commands(self):
        with patch.dict(r.os.environ, {}, clear=True), patch.object(r.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "remote_manual_only"):
                r.main()
            run.assert_not_called()

    def test_baseline_and_role_preparation_preserve_real_roles(self):
        path = Path(__file__).with_name("baseline.json")
        self.assertEqual(r.digest(path), r.BASELINE_SHA)
        baseline = json.loads(path.read_text())
        self.assertEqual([len(baseline[k]) for k in ("tables", "roles", "memberships", "default_acl")], [40, 29, 21, 12])
        text = r.role_sql(baseline)
        self.assertIn('CREATE ROLE "postgres" WITH NOSUPERUSER', text)
        self.assertIn('ALTER ROLE "supabase_admin" WITH SUPERUSER', text)
        self.assertIn('SET "session_preload_libraries" TO \'supautils\', \'safeupdate\';', text)
        self.assertNotIn('TO \'supautils, safeupdate\'', text)
        self.assertNotIn("PASSWORD", text)
        self.assertNotIn('CREATE ROLE "pg_monitor"', text)
        self.assertEqual(text.count("GRANTED BY supabase_admin;"), 21)
        self.assertIn('service_role=X/supabase_admin', baseline["kit_acl"]["functions"][1]["acl"])

    def test_schema_comparison_ignores_only_section_order_and_psql_guard(self):
        first = "--\n-- Name: f(); Type: FUNCTION; Schema: public; Owner: supabase_admin\n--\nCREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n"
        second = "--\n-- Name: TABLE t; Type: ACL; Schema: public; Owner: supabase_admin\n--\nGRANT SELECT ON public.t TO authenticated;\n"
        before = "\\restrict Ab123\n" + first + second + "\n--\n-- PostgreSQL database dump complete\n--\n\\unrestrict Ab123\n"
        after = "\\restrict C456\n" + second + first + "\n--\n-- PostgreSQL database dump complete\n--\n\\unrestrict C456\n"
        self.assertEqual(r.canonical_schema(before), r.canonical_schema(after))
        self.assertNotEqual(r.canonical_schema(before), r.canonical_schema(after.replace("SELECT 1", "SELECT 2")))
        self.assertNotEqual(r.canonical_schema(before), r.canonical_schema(after.replace("GRANT SELECT", "GRANT ALL")))
        with self.assertRaisesRegex(ValueError, "duplicate_schema_section"):
            r.canonical_schema(first + first)

    def test_default_acl_independent_grants_ignore_only_recipient_order(self):
        for kind in ("FUNCTIONS", "SEQUENCES", "TABLES"):
            for owner, schema, recipients in (("supabase_auth_admin", "auth", ("postgres", "dashboard_user")),
                                              ("supabase_admin", "public", ("postgres", "anon", "authenticated", "service_role"))):
                with self.subTest(kind=kind, schema=schema):
                    header = f"--\n-- Name: DEFAULT PRIVILEGES FOR {kind}; Type: DEFAULT ACL; Schema: {schema}; Owner: {owner}\n--\n"
                    grants = [f"ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {schema} GRANT ALL ON {kind} TO {recipient};" for recipient in recipients]
                    source = header + "\n".join(grants)
                    reordered = header + "\n".join(reversed(grants))
                    self.assertEqual(r.canonical_schema(source), r.canonical_schema(reordered))
                    mutations = [reordered.replace("GRANT ALL", "GRANT SELECT", 1),
                                 reordered.replace("TO postgres;", "TO other;", 1),
                                 reordered.replace(f"FOR ROLE {owner}", "FOR ROLE other", 1),
                                 reordered.replace(f"IN SCHEMA {schema}", "IN SCHEMA other", 1),
                                 reordered.replace(f"ON {kind}", "ON OTHER", 1),
                                 header + "\n".join(grants[:-1]),
                                 reordered + f"\nALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {schema} GRANT ALL ON {kind} TO other;",
                                 reordered.replace("TO postgres;", "TO postgres WITH GRANT OPTION;", 1)]
                    for mutation in mutations:
                        self.assertNotEqual(r.canonical_schema(source), r.canonical_schema(mutation))

    def test_default_acl_unknown_or_order_sensitive_sql_remains_literal(self):
        header = "--\n-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin\n--\n"
        grant = "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;"
        other = grant.replace("TO postgres", "TO anon")
        revoke = grant.replace("GRANT ALL", "REVOKE ALL").replace(" TO ", " FROM ")
        cases = [[grant, revoke], [grant, other, grant], [grant, "SELECT 1;"],
                 [grant, other.replace("FOR ROLE supabase_admin", "FOR ROLE other")],
                 [grant, other.replace("IN SCHEMA public", "IN SCHEMA other")],
                 [grant, other.replace("ON TABLES", "ON FUNCTIONS")],
                 [grant, other.replace("TO anon;", "TO anon WITH GRANT OPTION;")]]
        for statements in cases:
            with self.subTest(statements=statements):
                reversed_statements = statements[1:] + statements[:1]
                self.assertNotEqual(r.canonical_schema(header + "\n".join(statements)),
                                    r.canonical_schema(header + "\n".join(reversed_statements)))
        function_header = "--\n-- Name: f(); Type: FUNCTION; Schema: public; Owner: supabase_admin\n--\n"
        self.assertNotEqual(r.canonical_schema(function_header + grant + "\n" + other),
                            r.canonical_schema(function_header + other + "\n" + grant))

    def test_role_configuration_comparison_does_not_hide_quoted_library_delta(self):
        baseline = json.loads(Path(__file__).with_name("baseline.json").read_text())
        before = {key: copy.deepcopy(baseline[key]) for key in ("roles", "memberships", "default_acl")}
        after = copy.deepcopy(before)
        role = next(role for role in after["roles"] if role["rolname"] == "authenticator")
        role["rolconfig"] = [setting.replace("=supautils, safeupdate", '=\"supautils, safeupdate\"') for setting in role["rolconfig"]]
        self.assertNotEqual(r.normalize_globals(before)["roles"], r.normalize_globals(after)["roles"])

    def test_container_has_only_private_scratch_and_readonly_input(self):
        source = "/repo/input"
        data = {"HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True, "Privileged": False,
                               "CapDrop": ["ALL"], "SecurityOpt": ["no-new-privileges"], "PortBindings": {},
                               "Tmpfs": {"/qa": "rw,nosuid,noexec,size=512m,mode=1777", "/tmp": "rw,nosuid,noexec,size=64m,mode=1777"}},
                "Config": {"User": "postgres", "Entrypoint": ["/bin/bash"], "Cmd": ["-ceu", r.START]},
                "Mounts": [{"Type": "bind", "Source": source, "Destination": "/input", "RW": False}]}
        r.verify_container(data, source)
        for key, value in [("NetworkMode", "bridge"), ("ReadonlyRootfs", False), ("Privileged", True), ("Tmpfs", {"/etc": "rw"})]:
            changed = copy.deepcopy(data)
            changed["HostConfig"][key] = value
            with self.assertRaisesRegex(ValueError, "container_isolation"):
                r.verify_container(changed, source)
        data["Mounts"][0]["RW"] = True
        with self.assertRaisesRegex(ValueError, "container_isolation"):
            r.verify_container(data, source)
        command = r.create_command(source)
        self.assertIn("--no-healthcheck", command)
        self.assertNotIn("--publish", command)
        self.assertNotIn("--privileged", command)

    def test_acl_order_does_not_hide_privilege_changes(self):
        baseline = json.loads(Path(__file__).with_name("baseline.json").read_text())["kit_acl"]
        reordered = copy.deepcopy(baseline)
        reordered["table"]["acl"] = "{" + ",".join(reversed(reordered["table"]["acl"][1:-1].split(","))) + "}"
        self.assertEqual(r.normalize_kit(baseline), r.normalize_kit(reordered))
        reordered["table"]["acl"] = reordered["table"]["acl"].replace("authenticated=r/", "authenticated=arwdDxt/")
        self.assertNotEqual(r.normalize_kit(baseline), r.normalize_kit(reordered))

    def test_timeout_preserves_partial_stdout_and_stderr(self):
        error = subprocess.TimeoutExpired(["fixture"], 2, output=b"partial stdout", stderr=b"partial stderr")
        with tempfile.TemporaryDirectory() as directory, patch.object(r.subprocess, "run", side_effect=error):
            output = Path(directory)
            with self.assertRaises(subprocess.TimeoutExpired):
                r.run_captured(["fixture"], output, timeout=2, failure_filename="failure-server_start.txt")
            self.assertEqual((output / "failure-server_start.txt").read_bytes(), b"partial stdout")
            self.assertEqual((output / "failure-server_start.txt.stderr").read_bytes(), b"partial stderr")
            proof = json.loads((output / "failure-server_start.txt.capture.json").read_text())
            self.assertTrue(proof["partial_timeout"])
            self.assertEqual(proof["timeout_seconds"], 2)

    def test_stopped_container_keeps_initdb_error_in_bounded_docker_log(self):
        results = [SimpleNamespace(returncode=0, stdout=b"x" * 70000, stderr=b"initdb failed"),
                   SimpleNamespace(returncode=1, stdout=b"", stderr=b"container is not running")]
        with tempfile.TemporaryDirectory() as directory, patch.object(r.subprocess, "run", side_effect=results) as run:
            output = Path(directory)
            evidence = r.capture_diagnostics("a" * 64, output)
            self.assertEqual((output / "diagnostic-docker.txt").stat().st_size, 65536)
            self.assertEqual((output / "diagnostic-docker.txt.stderr").read_bytes(), b"initdb failed")
            self.assertEqual(evidence["initdb"]["exit_code"], 1)
            self.assertEqual(run.call_args_list[0].args[0][:4], ["docker", "logs", "--tail", "100"])
            self.assertIn("|| { cat /qa/initdb.log >&2; exit 1; }", r.START)

    def test_diagnostic_timeout_keeps_partial_output_and_continues(self):
        results = [subprocess.TimeoutExpired(["docker"], 10, output=b"available log", stderr=b""),
                   SimpleNamespace(returncode=0, stdout=b"initialization detail", stderr=b"")]
        with tempfile.TemporaryDirectory() as directory, patch.object(r.subprocess, "run", side_effect=results):
            output = Path(directory)
            evidence = r.capture_diagnostics("a" * 64, output)
            self.assertEqual(evidence["docker"]["error"], "TimeoutExpired")
            self.assertEqual((output / "diagnostic-docker.txt").read_bytes(), b"available log")
            self.assertEqual((output / "diagnostic-initdb.txt").read_bytes(), b"initialization detail")

    def test_library_loader_requires_exit_zero_and_exact_marker(self):
        for library in ("supautils", "safeupdate"):
            with self.subTest(library=library):
                command = Mock(return_value=SimpleNamespace(returncode=0, stdout=(library + "_loaded\n").encode()))
                self.assertEqual(r.load_library("a" * 64, library, command), {"exit_code": 0, "loaded": True})
                call = command.call_args
                self.assertIn("ON_ERROR_STOP=1", call.args[0])
                self.assertEqual(call.args[0][-2:], ["-d", "postgres"])
                self.assertEqual(call.kwargs["data"], f"LOAD '{library}'; SELECT '{library}_loaded';")
                self.assertEqual(call.kwargs["filename"], f"library-{library}.txt")
                self.assertFalse(call.kwargs["check"])
                command.return_value = SimpleNamespace(returncode=1, stdout=(library + "_loaded\n").encode())
                self.assertFalse(r.load_library("a" * 64, library, command)["loaded"])
                command.return_value = SimpleNamespace(returncode=0, stdout=b"unexpected")
                self.assertFalse(r.load_library("a" * 64, library, command)["loaded"])

    def test_library_probe_is_bounded_and_unknown_library_is_rejected(self):
        self.assertIn('for library in supautils safeupdate', r.LIBRARY_PATH_PROBE)
        self.assertIn('for directory in "$pglib" /nix/var/nix/profiles/default/lib', r.LIBRARY_PATH_PROBE)
        self.assertNotIn("find ", r.LIBRARY_PATH_PROBE)
        command = Mock()
        with self.assertRaisesRegex(ValueError, "library_allowlist"):
            r.load_library("a" * 64, "other", command)
        command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
