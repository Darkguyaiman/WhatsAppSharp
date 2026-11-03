namespace MessagingApp.Services;

public interface IFileStorageService
{
    Task<(bool Success, string? Url, string? FileName, long Size, string? ErrorMessage)> SaveFileAsync(IFormFile file);
}
