using MySql.Data.MySqlClient;

namespace MessagingApp.Configuration;

public static class MySqlSettings
{
    public static string BuildConnectionString(string? database = null)
    {
        var host = Require("MYSQL_HOST");
        var portText = Environment.GetEnvironmentVariable("MYSQL_PORT");
        if (string.IsNullOrWhiteSpace(portText))
            portText = "3306";
        if (!uint.TryParse(portText, out var port))
            throw new InvalidOperationException($"MYSQL_PORT must be a number between 0 and 65535. Got '{portText}'.");

        return new MySqlConnectionStringBuilder
        {
            Server = host,
            Port = port,
            Database = database ?? Require("MYSQL_DATABASE"),
            UserID = Require("MYSQL_USER"),
            Password = Environment.GetEnvironmentVariable("MYSQL_PASSWORD") ?? "",
            CharacterSet = string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("MYSQL_CHARSET"))
                ? "utf8mb4"
                : Environment.GetEnvironmentVariable("MYSQL_CHARSET")!
        }.ConnectionString;
    }

    static string Require(string key)
    {
        var value = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"Missing required environment variable '{key}'. Copy .env.example to .env and set your MySQL values.");
        return value;
    }
}
