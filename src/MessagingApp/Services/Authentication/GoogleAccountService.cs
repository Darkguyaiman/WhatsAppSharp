using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;
using MessagingApp.Models;

namespace MessagingApp.Services;

public sealed class GoogleAccountService(AppDbContext context)
{
    public async Task<User> FindOrCreateAsync(string subject, string email, string? name)
    {
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 255 || string.IsNullOrWhiteSpace(email) || email.Length > 100)
            throw new InvalidOperationException("Google did not return a usable identity.");
        var existing = await context.Users.SingleOrDefaultAsync(u => u.GoogleSubject == subject);
        if (existing != null)
        {
            existing.LastSeenAt = DateTime.UtcNow;
            await context.SaveChangesAsync();
            return existing;
        }
        email = email.Trim().ToLowerInvariant();
        // Password accounts have not verified their email; never link by email alone.
        if (await context.Users.AnyAsync(u => u.Email == email))
            throw new InvalidOperationException("An account already uses this email. Use password sign-in.");
        var displayName = string.IsNullOrWhiteSpace(name) ? email.Split('@')[0] : name.Trim();
        var user = new User
        {
            GoogleSubject = subject, Email = email,
            Username = "google_" + Guid.NewGuid().ToString("N"),
            DisplayName = displayName.Length > 100 ? displayName[..100] : displayName,
            PasswordHash = string.Empty
        };
        context.Users.Add(user);
        try { await context.SaveChangesAsync(); }
        catch (DbUpdateException)
        {
            context.Entry(user).State = EntityState.Detached;
            var concurrent = await context.Users.SingleOrDefaultAsync(u => u.GoogleSubject == subject);
            if (concurrent != null) return concurrent;
            throw;
        }
        return user;
    }
}
