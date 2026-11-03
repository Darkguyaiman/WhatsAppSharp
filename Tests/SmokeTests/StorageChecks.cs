using MessagingApp.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;

public static class StorageChecks
{
    public static async Task RunAsync(Action<bool,string> check)
    {
        var root=Path.Combine(Path.GetTempPath(),"messagingapp-upload-check-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try {
            var service=new FileStorageService(new TestEnvironment{WebRootPath=root});
            var saved=await service.SaveStreamAsync(new MemoryStream(new byte[1024*1024]),"sample.bin.txt",CancellationToken.None);
            check(saved.Success&&saved.Size==1024*1024&&File.Exists(Path.Combine(root,saved.Url!.TrimStart('/').Replace('/',Path.DirectorySeparatorChar))),"Uploads stream the exact file bytes to final storage");
            var tooLarge=await service.SaveStreamAsync(new MemoryStream(new byte[15*1024*1024+1]),"large.txt",CancellationToken.None);
            check(!tooLarge.Success&&Directory.GetFiles(Path.Combine(root,"uploads")).Length==1,"Oversized streamed uploads remove partial files");
            try {await service.SaveStreamAsync(new CancelledStream(new byte[131072]),"cancelled.txt",CancellationToken.None);throw new Exception("Expected cancellation");}catch(OperationCanceledException){}
            check(Directory.GetFiles(Path.Combine(root,"uploads")).Length==1,"Cancelled streamed uploads clean up partial files");
        }finally{Directory.Delete(root,true);}
    }
    sealed class CancelledStream(byte[] data):MemoryStream(data)
    {
        int reads;
        public override ValueTask<int> ReadAsync(Memory<byte> buffer,CancellationToken cancellationToken=default)=>++reads>1?ValueTask.FromException<int>(new OperationCanceledException()):base.ReadAsync(buffer,cancellationToken);
    }
    sealed class TestEnvironment:IWebHostEnvironment
    {
        public string WebRootPath{get;set;}="";public IFileProvider WebRootFileProvider{get;set;}=new NullFileProvider();
        public string ApplicationName{get;set;}="StorageChecks";public string EnvironmentName{get;set;}="Development";
        public string ContentRootPath{get;set;}="";public IFileProvider ContentRootFileProvider{get;set;}=new NullFileProvider();
    }
}
