namespace MessagingApp.Services;

public interface IFileStorageService
{
    Task<(bool Success, string? Url, string? FileName, long Size, string? ErrorMessage)> SaveFileAsync(IFormFile file);
    Task<(bool Success, string? Url, string? FileName, long Size, string? ErrorMessage)> SaveStreamAsync(Stream source,string fileName,CancellationToken cancellationToken);
}
