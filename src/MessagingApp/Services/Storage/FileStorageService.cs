namespace MessagingApp.Services;

public class FileStorageService : IFileStorageService
{
    private readonly IWebHostEnvironment _env;
    private const long MaxFileSize = 15 * 1024 * 1024; // 15MB

    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp", ".gif",
        ".pdf", ".doc", ".docx", ".txt", ".zip", ".xlsx", ".csv", ".mp3", ".mp4",
        ".webm", ".ogg", ".m4a", ".wav"
    };

    public FileStorageService(IWebHostEnvironment env)
    {
        _env = env;
    }

    public async Task<(bool Success, string? Url, string? FileName, long Size, string? ErrorMessage)> SaveFileAsync(IFormFile file)
    {
        if (file == null || file.Length == 0)
        {
            return (false, null, null, 0, "No file provided.");
        }

        if (file.Length > MaxFileSize)
        {
            return (false, null, null, 0, "File size exceeds the 15MB limit.");
        }

        var ext = Path.GetExtension(file.FileName);
        if (string.IsNullOrEmpty(ext) || !AllowedExtensions.Contains(ext))
        {
            return (false, null, null, 0, "File type not supported for upload.");
        }

        var uploadsFolder = Path.Combine(_env.WebRootPath, "uploads");
        if (!Directory.Exists(uploadsFolder))
        {
            Directory.CreateDirectory(uploadsFolder);
        }

        var safeFileName = $"{Guid.NewGuid():N}{ext.ToLowerInvariant()}";
        var fullPath = Path.Combine(uploadsFolder, safeFileName);

        using (var stream = new FileStream(fullPath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        var relativeUrl = $"/uploads/{safeFileName}";
        return (true, relativeUrl, Path.GetFileName(file.FileName), file.Length, null);
    }
}
