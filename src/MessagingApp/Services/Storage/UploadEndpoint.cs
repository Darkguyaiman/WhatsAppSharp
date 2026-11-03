using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

namespace MessagingApp.Services;

public static class UploadEndpoint
{
    public static async Task<IResult> Handle(HttpContext context,IFileStorageService storage,IAntiforgery antiforgery)
    {
        // Validate the header before reading multipart data; never buffer a form to obtain a token.
        if(!context.Request.Headers.ContainsKey("RequestVerificationToken"))return Results.BadRequest(new{error="Missing verification token."});
        try {await antiforgery.ValidateRequestAsync(context);}
        catch(AntiforgeryValidationException){return Results.BadRequest(new{error="Invalid verification token."});}
        var bodyLimit=context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if(bodyLimit is {IsReadOnly:false})bodyLimit.MaxRequestBodySize=16*1024*1024;
        try {
            if(!MediaTypeHeaderValue.TryParse(context.Request.ContentType,out var type)||!type.MediaType.Equals("multipart/form-data",StringComparison.OrdinalIgnoreCase))return Results.BadRequest(new{error="Choose a file to upload."});
            var boundary=HeaderUtilities.RemoveQuotes(type.Boundary).Value;
            if(string.IsNullOrEmpty(boundary)||boundary.Length>128)return Results.BadRequest(new{error="Invalid upload boundary."});
            var reader=new MultipartReader(boundary,context.Request.Body){BodyLengthLimit=15*1024*1024,HeadersCountLimit=16,HeadersLengthLimit=16384};
            MultipartSection? section;
            while((section=await reader.ReadNextSectionAsync(context.RequestAborted)) is not null) {
                if(!ContentDispositionHeaderValue.TryParse(section.ContentDisposition,out var disposition)||HeaderUtilities.RemoveQuotes(disposition.Name).Value!="file")continue;
                var name=HeaderUtilities.RemoveQuotes(disposition.FileName.HasValue?disposition.FileName:disposition.FileNameStar).Value;
                if(string.IsNullOrEmpty(name))continue;
                var result=await storage.SaveStreamAsync(section.Body,name,context.RequestAborted);
                return result.Success?Results.Ok(new{url=result.Url,name=result.FileName,size=result.Size}):Results.BadRequest(new{error=result.ErrorMessage});
            }
            return Results.BadRequest(new{error="No file provided."});
        }catch(InvalidDataException){return Results.BadRequest(new{error="Upload is invalid or exceeds the 15 MB limit."});}
    }
}
