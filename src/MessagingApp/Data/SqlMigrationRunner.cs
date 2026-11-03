using MySql.Data.MySqlClient;

namespace MessagingApp.Data;

public static class SqlMigrationRunner
{
    const string MigrationsTable = "__SchemaMigrations";

    public static async Task MigrateAsync(string connectionString, string? upToInclusive = null, CancellationToken cancellationToken = default)
    {
        await EnsureDatabaseExistsAsync(connectionString, cancellationToken);

        await using var connection = new MySqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        await EnsureMigrationsTableAsync(connection, cancellationToken);
        await BridgeFromEfHistoryIfNeededAsync(connection, cancellationToken);

        var migrationsDir = ResolveMigrationsDirectory();
        var scripts = Directory.GetFiles(migrationsDir, "*.sql")
            .Select(path => new FileInfo(path))
            .OrderBy(file => file.Name, StringComparer.Ordinal)
            .ToList();

        if (scripts.Count == 0)
            throw new InvalidOperationException($"No SQL migrations found in '{migrationsDir}'.");

        if (upToInclusive is not null && scripts.All(file => !string.Equals(file.Name, upToInclusive, StringComparison.Ordinal)))
            throw new InvalidOperationException($"Unknown migration '{upToInclusive}'.");

        var applied = await GetAppliedMigrationsAsync(connection, cancellationToken);

        foreach (var script in scripts)
        {
            if (applied.Contains(script.Name))
            {
                if (upToInclusive is not null && string.Equals(script.Name, upToInclusive, StringComparison.Ordinal))
                    break;
                continue;
            }

            if (upToInclusive is not null &&
                string.Compare(script.Name, upToInclusive, StringComparison.Ordinal) > 0)
            {
                break;
            }

            var sql = await File.ReadAllTextAsync(script.FullName, cancellationToken);
            var batch = new MySqlScript(connection, sql);
            batch.Execute();

            await using (var insert = connection.CreateCommand())
            {
                insert.CommandText = $"INSERT INTO `{MigrationsTable}` (`Id`, `AppliedAt`) VALUES (@id, UTC_TIMESTAMP(6))";
                insert.Parameters.AddWithValue("@id", script.Name);
                await insert.ExecuteNonQueryAsync(cancellationToken);
            }

            if (upToInclusive is not null && string.Equals(script.Name, upToInclusive, StringComparison.Ordinal))
                break;
        }
    }

    static async Task EnsureDatabaseExistsAsync(string connectionString, CancellationToken cancellationToken)
    {
        var builder = new MySqlConnectionStringBuilder(connectionString);
        var database = builder.Database;
        if (string.IsNullOrWhiteSpace(database))
            throw new InvalidOperationException("MySQL connection string must include a database name.");

        builder.Database = "";
        await using var connection = new MySqlConnection(builder.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText =
            $"CREATE DATABASE IF NOT EXISTS `{database.Replace("`", "``")}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;";
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    static async Task EnsureMigrationsTableAsync(MySqlConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            $"""
             CREATE TABLE IF NOT EXISTS `{MigrationsTable}` (
               `Id` varchar(255) NOT NULL,
               `AppliedAt` datetime(6) NOT NULL,
               PRIMARY KEY (`Id`)
             ) CHARACTER SET utf8mb4;
             """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    static async Task BridgeFromEfHistoryIfNeededAsync(MySqlConnection connection, CancellationToken cancellationToken)
    {
        if (await CountAsync(connection, $"SELECT COUNT(*) FROM `{MigrationsTable}`", cancellationToken) > 0)
            return;

        if (!await TableExistsAsync(connection, "__EFMigrationsHistory", cancellationToken))
            return;

        var efIds = new[]
        {
            "20260915024140_InitialCreate",
            "20261001144912_WebPushAndMessagePaging",
            "20261002015451_SavedAvatarColors"
        };

        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT `MigrationId` FROM `__EFMigrationsHistory`";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var present = new HashSet<string>(StringComparer.Ordinal);
            while (await reader.ReadAsync(cancellationToken))
                present.Add(reader.GetString(0));

            if (!efIds.All(present.Contains))
                return;
        }

        var sqlNames = new[]
        {
            "001_initial_create.sql",
            "002_web_push_and_message_paging.sql",
            "003_saved_avatar_colors.sql"
        };

        foreach (var name in sqlNames)
        {
            await using var insert = connection.CreateCommand();
            insert.CommandText = $"INSERT INTO `{MigrationsTable}` (`Id`, `AppliedAt`) VALUES (@id, UTC_TIMESTAMP(6))";
            insert.Parameters.AddWithValue("@id", name);
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    static async Task<HashSet<string>> GetAppliedMigrationsAsync(MySqlConnection connection, CancellationToken cancellationToken)
    {
        var applied = new HashSet<string>(StringComparer.Ordinal);
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT `Id` FROM `{MigrationsTable}`";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            applied.Add(reader.GetString(0));
        return applied;
    }

    static async Task<bool> TableExistsAsync(MySqlConnection connection, string tableName, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = @name;
            """;
        command.Parameters.AddWithValue("@name", tableName);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return Convert.ToInt64(result) > 0;
    }

    static async Task<long> CountAsync(MySqlConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return Convert.ToInt64(result);
    }

    static string ResolveMigrationsDirectory()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "Database", "Migrations"),
            Path.Combine(Directory.GetCurrentDirectory(), "Database", "Migrations")
        };

        foreach (var candidate in candidates)
        {
            if (Directory.Exists(candidate))
                return candidate;
        }

        throw new InvalidOperationException(
            "Could not find Database/Migrations. Ensure SQL scripts are copied to the output directory.");
    }
}
