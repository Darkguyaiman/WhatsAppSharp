using MessagingApp.Hubs;
using MessagingApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.SignalR;

namespace MessagingApp.Pages.Api;

[AllowAnonymous]
[IgnoreAntiforgeryToken] // A purpose-bound, expiring push token is the sole authorization.
[RequestSizeLimit(8192)]
[ResponseCache(NoStore=true, Location=ResponseCacheLocation.None)]
public sealed class DeliveryModel(DeliveryTokenService tokens, IMessageService messages, IHubContext<ChatHub> hub) : PageModel
{
    public sealed class ReceiptInput { public string? Token { get; set; } }
    public async Task<IActionResult> OnPostAsync([FromBody] ReceiptInput? input)
    {
        if (!tokens.TryRead(input?.Token,out var messageId,out var recipient)) return BadRequest();
        var receipts=await messages.MarkMessagesDeliveredAsync([messageId],recipient);
        foreach(var receipt in receipts)
            await hub.Clients.User(receipt.SenderId.ToString()).SendAsync("MessagesDelivered",new { receipt.ConversationId,MessageIds=new[]{receipt.MessageId} });
        return new JsonResult(new {success=true});
    }
}
