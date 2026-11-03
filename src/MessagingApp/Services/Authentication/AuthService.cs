using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;
using MessagingApp.Models;

namespace MessagingApp.Services;

public class AuthService : IAuthService
{
    private readonly AppDbContext _context;
    private readonly IPasswordHasher<User> _passwordHasher;

    public AuthService(AppDbContext context)
    {
        _context = context;
        _passwordHasher = new PasswordHasher<User>();
    }

    public async Task<(bool Success, string? ErrorMessage, User? User)> RegisterAsync(
        string username, string email, string password, string displayName, string? avatarUrl, string? about)
    {
        username = username.Trim().ToLowerInvariant();
        email = email.Trim().ToLowerInvariant();

        if (await _context.Users.AnyAsync(u => u.Username == username))
        {
            return (false, "Username is already taken.", null);
        }

        if (await _context.Users.AnyAsync(u => u.Email == email))
        {
            return (false, "Email address is already in use.", null);
        }

        var user = new User
        {
            Username = username,
            Email = email,
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? username : displayName.Trim(),
            AvatarUrl = string.IsNullOrWhiteSpace(avatarUrl) ? "/images/avatars/avatar-default.svg" : avatarUrl,
            About = string.IsNullOrWhiteSpace(about) ? "Hey there! I am using WhatsAppSharp." : about.Trim(),
            CreatedAt = DateTime.UtcNow,
            LastSeenAt = DateTime.UtcNow
        };

        user.PasswordHash = _passwordHasher.HashPassword(user, password);

        _context.Users.Add(user);
        await _context.SaveChangesAsync();

        return (true, null, user);
    }

    public async Task<(bool Success, string? ErrorMessage, User? User)> ValidateUserAsync(string usernameOrEmail, string password)
    {
        var input = usernameOrEmail.Trim().ToLowerInvariant();
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == input || u.Email == input);

        if (user == null || string.IsNullOrEmpty(user.PasswordHash))
        {
            return (false, "Invalid username or password.", null);
        }

        var verificationResult = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (verificationResult == PasswordVerificationResult.Failed)
        {
            return (false, "Invalid username or password.", null);
        }

        user.LastSeenAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        return (true, null, user);
    }

    public async Task<User?> GetUserByIdAsync(int id)
    {
        return await _context.Users.FindAsync(id);
    }

    public async Task<(bool Success, string? ErrorMessage)> UpdateProfileAsync(int userId, string displayName, string? about, string? avatarUrl, string? username = null)
    {
        var user = await _context.Users.FindAsync(userId);
        if (user == null)
        {
            return (false, "User not found.");
        }

        if (username != null)
        {
            username = username.Trim().ToLowerInvariant();
            if (!System.Text.RegularExpressions.Regex.IsMatch(username, @"^[a-z0-9_.]{3,50}$"))
                return (false, "Use 3–50 letters, numbers, dots, or underscores for your username.");
            if (await _context.Users.AnyAsync(u => u.Username == username && u.Id != userId))
                return (false, "That username is already taken. Please choose another.");
        }
        if (string.IsNullOrWhiteSpace(displayName) || displayName.Trim().Length > 100 || about?.Length > 255)
            return (false, "Check the length of your name and about text.");
        if (!string.IsNullOrEmpty(avatarUrl) && avatarUrl != user.AvatarUrl && !AvatarAppearance.IsDefault(avatarUrl) &&
            !System.Text.RegularExpressions.Regex.IsMatch(avatarUrl, @"^/uploads/[a-f0-9]{32}\.(jpg|jpeg|png|gif|webp)$"))
            return (false, "Choose an uploaded photo or use your initials.");
        if (username != null) user.Username = username;

        if (!string.IsNullOrWhiteSpace(displayName))
        {
            user.DisplayName = displayName.Trim();
        }

        if (about != null)
        {
            user.About = about.Trim();
        }

        if (!string.IsNullOrWhiteSpace(avatarUrl))
        {
            user.AvatarUrl = avatarUrl.Trim();
        }

        try { await _context.SaveChangesAsync(); }
        catch (DbUpdateException) { return (false, "Your profile could not be saved. The username may have just been taken; please try another."); }
        return (true, null);
    }
}
