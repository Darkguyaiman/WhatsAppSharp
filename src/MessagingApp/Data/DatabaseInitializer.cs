using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Models;

namespace MessagingApp.Data;

public static class DatabaseInitializer
{
    public static async Task InitializeAsync(AppDbContext context)
    {
        await SqlMigrationRunner.MigrateAsync(context.Database.GetConnectionString()
            ?? throw new InvalidOperationException("Database connection string is missing."));
        // Identify only the original fixtures by both identity and known demo password.
        string[] names = ["alex", "sarah", "john", "emma", "david"];
        var candidates = await context.Users.Where(u => names.Contains(u.Username) && u.GoogleSubject == null).ToListAsync();
        var hasher = new PasswordHasher<User>();
        var ids = candidates.Where(u => u.Email == u.Username + "@example.com" &&
            hasher.VerifyHashedPassword(u, u.PasswordHash, "Password123!") != PasswordVerificationResult.Failed)
            .Select(u => u.Id).ToArray();
        if (ids.Length == 0) return;
        await using var transaction = await context.Database.BeginTransactionAsync();
        var demoConversations = await context.Conversations.Where(c => c.Members.Any() &&
            c.Members.All(m => ids.Contains(m.UserId))).Select(c => c.Id).ToListAsync();
        await context.Conversations.Where(c => demoConversations.Contains(c.Id)).ExecuteDeleteAsync();
        await context.Messages.Where(m => ids.Contains(m.SenderId)).ExecuteDeleteAsync();
        await context.MessageReactions.Where(r => ids.Contains(r.UserId)).ExecuteDeleteAsync();
        await context.MessageReads.Where(r => ids.Contains(r.UserId)).ExecuteDeleteAsync();
        await context.ConversationMembers.Where(m => ids.Contains(m.UserId)).ExecuteDeleteAsync();
        await context.Users.Where(u => ids.Contains(u.Id)).ExecuteDeleteAsync();
        await transaction.CommitAsync();
    }
}
