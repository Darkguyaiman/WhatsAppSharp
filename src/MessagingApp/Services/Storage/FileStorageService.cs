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

        await using var source=file.OpenReadStream();
        return await SaveStreamAsync(source,file.FileName,CancellationToken.None);
    }

    public async Task<(bool Success, string? Url, string? FileName, long Size, string? ErrorMessage)> SaveStreamAsync(Stream source,string fileName,CancellationToken cancellationToken)
    {
        var ext = Path.GetExtension(fileName);
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

        var buffer=System.Buffers.ArrayPool<byte>.Shared.Rent(65536);
        var committed=false;long length=0;
        try {
            await using(var stream=new FileStream(fullPath,new FileStreamOptions{Mode=FileMode.CreateNew,Access=FileAccess.Write,Share=FileShare.None,Options=FileOptions.Asynchronous|FileOptions.SequentialScan,BufferSize=65536})) {
                int count;
                while((count=await source.ReadAsync(buffer.AsMemory(),cancellationToken))>0) {
                    length+=count;
                    if(length>MaxFileSize)return(false,null,null,0,"File size exceeds the 15MB limit.");
                    await stream.WriteAsync(buffer.AsMemory(0,count),cancellationToken);
                }
            }
            if(length==0)return(false,null,null,0,"No file provided.");
            committed=true;
            return(true,$"/uploads/{safeFileName}",Path.GetFileName(fileName),length,null);
        } finally {
            System.Buffers.ArrayPool<byte>.Shared.Return(buffer);
            if(!committed&&File.Exists(fullPath))File.Delete(fullPath);
        }
    }
}
