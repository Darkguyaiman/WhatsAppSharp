using MessagingApp.Models;

namespace MessagingApp.Services;

public interface IAuthService
{
    Task<(bool Success, string? ErrorMessage, User? User)> RegisterAsync(string username, string email, string password, string displayName, string? avatarUrl, string? about);
    Task<(bool Success, string? ErrorMessage, User? User)> ValidateUserAsync(string usernameOrEmail, string password);
    Task<User?> GetUserByIdAsync(int id);
    Task<(bool Success, string? ErrorMessage)> UpdateProfileAsync(int userId, string displayName, string? about, string? avatarUrl, string? username = null);
}
