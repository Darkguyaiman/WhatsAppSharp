using System.Text.Json;

namespace MessagingApp.Models;

public static class MessageContentPreview
{
    public static string Text(string? content)
    {
        if(string.IsNullOrWhiteSpace(content))return "No messages yet";
        if(!content.TrimStart().StartsWith('{'))return content;
        try
        {
            using var document=JsonDocument.Parse(content);
            var root=document.RootElement;
            if(root.ValueKind!=JsonValueKind.Object||!root.TryGetProperty("wa",out var kind)||kind.ValueKind!=JsonValueKind.String)return content;
            string Field(string name)=>root.TryGetProperty(name,out var field)&&field.ValueKind==JsonValueKind.String?field.GetString()??"":"";
            return kind.GetString() switch {
                "voice"=>"Voice message",
                "contact"=>"Contact: "+(Field("name") is {Length:>0} name?name:Field("username")),
                "poll"=>"Poll: "+Field("question"),"event"=>"Event: "+Field("title"),"catalogue"=>"Catalogue: "+Field("name"),
                "sticker"=>Field("caption") is {Length:>0} caption?caption:"Sticker",_=>content
            };
        }
        catch(JsonException){return content;}
    }
}
