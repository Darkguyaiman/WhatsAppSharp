namespace MessagingApp.Configuration;

public static class DotEnv
{
    // Published deployments keep .env beside the app. Development keeps it at the repository root.
    public static void LoadApplicationEnvironment()
    {
        Load(Path.Combine(Directory.GetCurrentDirectory(), ".env"));
        var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "MessagingApp.slnx")))
            {
                Load(Path.Combine(directory.FullName, ".env"));
                break;
            }
            directory = directory.Parent;
        }
    }

    public static void Load(string path)
    {
        if (!File.Exists(path))
            return;

        foreach (var raw in File.ReadLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#'))
                continue;

            var separator = line.IndexOf('=');
            if (separator <= 0)
                continue;

            var key = line[..separator].Trim();
            if (key.Length == 0 || Environment.GetEnvironmentVariable(key) is not null)
                continue;

            var value = line[(separator + 1)..].Trim();
            if (value.Length >= 2 &&
                ((value.StartsWith('"') && value.EndsWith('"')) || (value.StartsWith('\'') && value.EndsWith('\''))))
            {
                value = value[1..^1];
            }

            Environment.SetEnvironmentVariable(key, value);
        }
    }
}
