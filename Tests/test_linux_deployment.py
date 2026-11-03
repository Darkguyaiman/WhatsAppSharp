"""Check deployment credentials, repeat runs, validation, and installer arguments."""

import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("deployment", ROOT / "scripts/configure-linux.py")
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class DeploymentConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.config = Path(self.folder.name) / "app.env"

    def test_local_setup_generates_dedicated_credentials_and_preserves_them_on_update(self):
        first = deployment.configure(self.config, "local")
        self.assertEqual(first["MYSQL_USER"], "messagingapp")
        self.assertEqual(len(first["MYSQL_PASSWORD"]), 64)
        second = deployment.configure(self.config, "local")
        self.assertEqual(first, second)
        sql = deployment.local_database_sql(second)
        self.assertIn("GRANT ALL PRIVILEGES ON `messagingapp`.*", sql)
        self.assertNotIn("ALTER USER", sql)
        self.assertNotIn("ON *.*", sql)

    def test_existing_settings_are_preserved_and_never_executed(self):
        deployment.configure(self.config, "local")
        with self.config.open("a", encoding="utf-8") as output:
            output.write("Custom__Setting=$(this is not shell code)\n")
        values = deployment.configure(self.config, "local")
        self.assertEqual(values["Custom__Setting"], "$(this is not shell code)")

    def test_external_configuration_requires_credentials_before_writing(self):
        with self.assertRaisesRegex(ValueError, "External MySQL requires"):
            deployment.configure(self.config, "external")
        self.assertFalse(self.config.exists())

    def test_external_configuration_preserves_password_and_enforces_production(self):
        source = Path(self.folder.name) / "source.env"
        source.write_text("MYSQL_HOST=db.example\nMYSQL_DATABASE=chat\nMYSQL_USER=chat\n"
                          "MYSQL_PASSWORD='a password with # and = symbols'\n"
                          "Authentication__Google__ClientSecret=keep-this\n"
                          "ASPNETCORE_ENVIRONMENT=Development\nASPNETCORE_URLS=http://*:9999\n"
                          "Kestrel__Endpoints__Http__Url=http://*:9998\n", encoding="utf-8")
        values = deployment.configure(self.config, "external", source)
        self.assertEqual(values["MYSQL_PASSWORD"], "a password with # and = symbols")
        self.assertEqual(values["Authentication__Google__ClientSecret"], "keep-this")
        self.assertEqual(values["ASPNETCORE_ENVIRONMENT"], "Production")
        self.assertNotIn("ASPNETCORE_URLS", values)
        self.assertNotIn("Kestrel__Endpoints__Http__Url", values)
        self.assertEqual(deployment.read_env(self.config), values)

    def test_import_cannot_overwrite_existing_deployment_settings(self):
        before = deployment.configure(self.config, "local")
        with self.assertRaisesRegex(ValueError, "already exists"):
            deployment.configure(self.config, "local", self.config)
        self.assertEqual(deployment.read_env(self.config), before)

    def test_external_connection_string_is_supported(self):
        self.config.write_text("ConnectionStrings__DefaultConnection=Server=db;Database=chat;Uid=chat;Pwd=secret;\n", encoding="utf-8")
        values = deployment.configure(self.config, "external")
        self.assertIn("ConnectionStrings__DefaultConnection", values)

    def test_local_setup_rejects_root_remote_hosts_and_sql_injection(self):
        base = deployment.configure(self.config, "local")
        for key, value in (("MYSQL_USER", "root"), ("MYSQL_HOST", "remote"),
                           ("MYSQL_DATABASE", "chat`; DROP DATABASE chat;"),
                           ("MYSQL_PASSWORD", "unsafe'password")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                deployment.local_database_sql({**base, key: value})

    def test_quoted_and_unquoted_values_round_trip(self):
        self.config.write_text("# comment\nA='hello world'\nB=first=second\nC=\"quoted\"\n", encoding="utf-8")
        self.assertEqual(deployment.read_env(self.config), {"A": "hello world", "B": "first=second", "C": "quoted"})


class InstallerArgumentsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bash = shutil.which("bash")
        if not cls.bash:
            candidate = Path("C:/Program Files/Git/bin/bash.exe")
            cls.bash = str(candidate) if candidate.exists() else None
        if not cls.bash:
            raise unittest.SkipTest("Bash is not installed")

    def run_installer(self, *args):
        return subprocess.run([self.bash, "deploy.sh", *args], cwd=ROOT,
                              text=True, capture_output=True, timeout=10)

    def test_bash_syntax_and_help(self):
        syntax = subprocess.run([self.bash, "-n", "deploy.sh"], cwd=ROOT, capture_output=True)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        help_result = self.run_installer("--help")
        self.assertEqual(help_result.returncode, 0)
        self.assertIn("--port 8080", help_result.stdout)

    def test_invalid_options_fail_before_any_system_changes(self):
        for args in (("--port", "0"), ("--port", "65536"), ("--port", "nope"),
                     ("--port", "80"), ("--port",), ("--bind", "bad"),
                     ("--database", "bad"), ("--unknown",)):
            with self.subTest(args=args):
                result = self.run_installer(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Error:", result.stderr)


if __name__ == "__main__":
    unittest.main()
