using System.Net.Http.Json;
using System.Text.Json;
using MessagingApp.Data;
using MessagingApp.Models;
using MessagingApp.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;

public static class MessageActionChecks
{
    public static async Task RunAsync(HttpClient alex, HttpClient sarah, HubConnection a, HubConnection b,
        string origin, int directId, int groupId, int alexId, DbContextOptions<AppDbContext> options, Action<bool,string> check)
    {
        async Task<List<MessageDto>> History(HttpClient client, int conversationId) =>
            (await client.GetFromJsonAsync<List<MessageDto>>($"{origin}/Chat?handler=Messages&conversationId={conversationId}"))!;
        async Task<MessageDto> Send(HubConnection hub, HttpClient client, int conversationId, string text)
        {
            await hub.InvokeAsync("SendMessage", conversationId, text, "Text", null, null, null, null);
            return (await History(client, conversationId)).Last();
        }
        async Task<bool> Rejected(Func<Task> action) { try { await action(); return false; } catch (HubException) { return true; } }

        await a.InvokeAsync("JoinConversation", groupId); await b.InvokeAsync("JoinConversation", groupId);
        var editable=await Send(a,alex,directId,"Original edit-window message");
        await using(var db=new AppDbContext(options))await db.Messages.Where(m=>m.Id==editable.Id).ExecuteUpdateAsync(s=>s.SetProperty(m=>m.CreatedAt,DateTime.UtcNow.AddMinutes(-14)));
        await a.InvokeAsync("EditMessage",editable.Id,"Edited within the original window");
        check((await History(alex,directId)).Single(m=>m.Id==editable.Id).Content=="Edited within the original window","Messages can be edited within 15 minutes of their original send time");
        await using(var db=new AppDbContext(options))await db.Messages.Where(m=>m.Id==editable.Id).ExecuteUpdateAsync(s=>s.SetProperty(m=>m.CreatedAt,DateTime.UtcNow.AddMinutes(-16)));
        check(await Rejected(()=>a.InvokeAsync("EditMessage",editable.Id,"Must not extend the window")),"A recent edit does not extend the original 15-minute deadline");
        check((await History(alex,directId)).Single(m=>m.Id==editable.Id).Content=="Edited within the original window","Expired edit attempts leave the saved message intact");
        var source = await Send(b, sarah, directId, "Forward and star this received message");
        int privateMessageId;
        await using(var db=new AppDbContext(options))
        {
            var privateChat=new Conversation{IsGroup=true,Title="Private delivery fixture"};db.Conversations.Add(privateChat);await db.SaveChangesAsync();
            db.ConversationMembers.Add(new ConversationMember{ConversationId=privateChat.Id,UserId=source.SenderId});
            var privateMessage=new Message{ConversationId=privateChat.Id,SenderId=source.SenderId,Content="Not available to Alex"};db.Messages.Add(privateMessage);await db.SaveChangesAsync();privateMessageId=privateMessage.Id;
        }
        await a.InvokeAsync("MarkMessagesDelivered",new[]{privateMessageId});
        await using(var db=new AppDbContext(options))check(!await db.MessageDeliveries.AnyAsync(r=>r.MessageId==privateMessageId),"Delivery acknowledgements reject IDs outside the account's conversations");
        check((await a.InvokeAsync<List<MessageDto>>("GetUndeliveredMessages")).All(m=>m.Id!=privateMessageId),"Delivery sync does not expose another conversation's content");
        check(await Rejected(()=>a.InvokeAsync("MarkMessagesDelivered",Enumerable.Range(1,101).ToArray())),"Delivery acknowledgements are bounded to 100 messages per request");
        await a.InvokeAsync("SetMessageStar", source.Id, true);
        await a.InvokeAsync("SaveMessageNote", source.Id, "Only Alex can see this private note");
        var mine = (await History(alex,directId)).Single(m=>m.Id==source.Id);
        var theirs = (await History(sarah,directId)).Single(m=>m.Id==source.Id);
        check(mine.IsStarred && mine.Note == "Only Alex can see this private note" && !theirs.IsStarred && theirs.Note == null,
            "Stars and notes persist only for the acting account");
        var starList = await a.InvokeAsync<List<MessageDto>>("GetSavedMessages", false);
        var noteList = await a.InvokeAsync<List<MessageDto>>("GetSavedMessages", true);
        var peerNotes = await b.InvokeAsync<List<MessageDto>>("GetSavedMessages", true);
        check(starList.Any(m=>m.Id==source.Id) && noteList.Any(m=>m.Id==source.Id) && peerNotes.All(m=>m.Id!=source.Id),
            "Saved-message lists enforce account privacy");
        var reaction = new TaskCompletionSource<MessageDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = b.On<MessageDto>("MessageReactionUpdated", m=>{if(m.Id==source.Id)reaction.TrySetResult(m);});
        await a.InvokeAsync("SendReaction", source.Id, "🦊");
        var update = await reaction.Task.WaitAsync(TimeSpan.FromSeconds(5));
        check(update.Note == null && !update.IsStarred && update.Reactions.Single().Emoji == "🦊",
            "Reactions support the emoji picker without leaking private message state");
        check(await Rejected(()=>a.InvokeAsync("SendReaction",source.Id,"<script>")), "Reaction input rejects non-emoji content");
        await a.InvokeAsync("SendReaction",source.Id,"❤️");
        var changed=(await History(alex,directId)).Single(m=>m.Id==source.Id);
        check(changed.Reactions.Count==1 && changed.Reactions[0].Emoji=="❤️" && changed.Reactions[0].HasReacted,
            "Choosing another emoji replaces the person's previous reaction");
        await b.InvokeAsync("SendReaction",source.Id,"❤️");
        check((await History(alex,directId)).Single(m=>m.Id==source.Id).Reactions.Single().Count==2,
            "Different people may each react once with the same emoji");
        await a.InvokeAsync("SendReaction",source.Id,"❤️");
        var removed=(await History(alex,directId)).Single(m=>m.Id==source.Id);
        check(removed.Reactions.Single().Count==1 && !removed.Reactions.Single().HasReacted,
            "Selecting the same emoji removes only your own reaction");
        await b.InvokeAsync("SendReaction",source.Id,"❤️");
        var concurrent=await Task.WhenAll(new[]{"👍","😂","❤️","😮","🙏","🦊"}.Select(async emoji=>{
            await using var db=new AppDbContext(options);
            return await new MessageService(db,new UserPresenceService()).ToggleReactionAsync(source.Id,alexId,emoji);
        }));
        await using(var db=new AppDbContext(options))
            check(concurrent.All(result=>result.Success) && await db.MessageReactions.CountAsync(r=>r.MessageId==source.Id && r.UserId==alexId)==1,
                "Simultaneous reaction changes from multiple tabs still leave a single reaction");

        await a.InvokeAsync("ForwardMessage", source.Id, new[]{groupId});
        var forwarded=(await History(alex,groupId)).Last();
        check(forwarded.IsForwarded && forwarded.Content==source.Content && forwarded.SenderId==alexId && forwarded.ReplyTo==null && forwarded.Note==null,
            "Received messages can be forwarded with a shared label and no private notes");
        await a.InvokeAsync("ForwardMessage", source.Id, new[]{directId});
        check((await History(sarah,directId)).Last().IsForwarded, "Messages can be forwarded to an existing direct chat");
        check(await Rejected(()=>a.InvokeAsync("ForwardMessage",source.Id,new[]{1,2,3,4,5,6})), "Forwarding cannot exceed five chats");
        check(await Rejected(()=>a.InvokeAsync("ForwardMessage",source.Id,Array.Empty<int>())), "Forwarding requires a recipient selection");

        await a.InvokeAsync("SetMessagePin", source.Id, true, 24);
        var pins=await b.InvokeAsync<JsonElement>("GetPinnedMessages",directId);
        check(pins.EnumerateArray().Any(p=>p.GetProperty("message").GetProperty("id").GetInt32()==source.Id),
            "Pinned messages are shared with chat members");
        await using(var db=new AppDbContext(options))
        {
            var pin=await db.MessagePins.SingleAsync(p=>p.MessageId==source.Id);
            check(pin.ExpiresAt>DateTime.UtcNow.AddHours(23) && pin.ExpiresAt<DateTime.UtcNow.AddHours(25),"Pin durations are saved on the server");
            pin.ExpiresAt=DateTime.UtcNow.AddSeconds(-1);await db.SaveChangesAsync();
        }
        check((await b.InvokeAsync<JsonElement>("GetPinnedMessages",directId)).GetArrayLength()==0,"Expired pins are no longer returned");
        var pinnedIds=new List<int>();
        for(var i=0;i<4;i++)
        {
            var candidate=await Send(a,alex,directId,"Pin candidate "+i);pinnedIds.Add(candidate.Id);
            if(i<3)await a.InvokeAsync("SetMessagePin",candidate.Id,true,168);
        }
        check(await Rejected(()=>a.InvokeAsync("SetMessagePin",pinnedIds[3],true,168)),"Chats enforce a maximum of three active pins");
        foreach(var id in pinnedIds.Take(3))await a.InvokeAsync("SetMessagePin",id,false,168);

        var previous=await Send(a,alex,directId,"Previous visible preview");
        var hidden=await Send(b,sarah,directId,"Delete just my copy");
        var received=(await History(alex,directId)).Single(m=>m.Id==hidden.Id);
        check(!received.CanDeleteForEveryone && (await History(sarah,directId)).Single(m=>m.Id==hidden.Id).CanDeleteForEveryone,
            "Delete-for-everyone permissions distinguish received and own messages");
        await a.InvokeAsync("DeleteMessageForMe",hidden.Id);await a.InvokeAsync("DeleteMessageForMe",hidden.Id);
        check((await History(alex,directId)).All(m=>m.Id!=hidden.Id) && (await History(sarah,directId)).Any(m=>m.Id==hidden.Id && !m.IsDeleted),
            "Delete for me is idempotent and leaves the other person's message intact");
        var privatePreview=(await alex.GetFromJsonAsync<List<ConversationDto>>($"{origin}/Chat?handler=Conversations"))!.Single(c=>c.Id==directId);
        var sharedPreview=(await sarah.GetFromJsonAsync<List<ConversationDto>>($"{origin}/Chat?handler=Conversations"))!.Single(c=>c.Id==directId);
        check(privatePreview.LastMessageContent==previous.Content && sharedPreview.LastMessageContent==hidden.Content,
            "Conversation previews respect per-account deletion");
        var search=(await alex.GetFromJsonAsync<List<MessageDto>>($"{origin}/Chat?handler=SearchMessages&conversationId={directId}&query=Delete%20just"))!;
        check(search.Count==0,"Search excludes messages deleted for the current account");
        await a.InvokeAsync("MarkMessagesDelivered",new[]{hidden.Id});
        await using(var db=new AppDbContext(options))check(!await db.MessageDeliveries.AnyAsync(r=>r.MessageId==hidden.Id&&r.UserId==alexId),"Privately hidden messages cannot be acknowledged by guessing their ID");
        var liveReply = new TaskCompletionSource<MessageDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var replySubscription = a.On<MessageDto>("ReceiveMessage", m=>{if(m.ReplyTo?.Id==hidden.Id)liveReply.TrySetResult(m);});
        await b.InvokeAsync("SendMessage", directId, "Reply to a privately deleted message", "Text", null, null, null, hidden.Id);
        var quoted = await liveReply.Task.WaitAsync(TimeSpan.FromSeconds(5));
        check(quoted.ReplyTo?.Content=="Message unavailable" &&
            (await History(sarah,directId)).Single(m=>m.Id==quoted.Id).ReplyTo?.Content==hidden.Content,
            "Live replies respect each recipient's private deletion of the quoted message");
        var liveReaction = new TaskCompletionSource<MessageDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var replyReaction = b.On<MessageDto>("MessageReactionUpdated", m=>{if(m.Id==quoted.Id)liveReaction.TrySetResult(m);});
        await a.InvokeAsync("SendReaction", quoted.Id, "❤️");
        check((await liveReaction.Task.WaitAsync(TimeSpan.FromSeconds(5))).ReplyTo?.Content==hidden.Content,
            "One member's hidden quote does not replace another member's live quote");
        check(await Rejected(()=>a.InvokeAsync("DeleteMessage",hidden.Id)),"A recipient cannot delete another person's direct message for everyone");
        check(await Rejected(()=>a.InvokeAsync("ForwardMessage",hidden.Id,new[]{groupId})),"Hidden messages cannot be forwarded by guessing their ID");
        check(await Rejected(()=>a.InvokeAsync("GetMessageInfo",hidden.Id)),"Hidden message details remain unavailable");
        await b.InvokeAsync("DeleteMessage",hidden.Id);
        check((await History(alex,directId)).All(m=>m.Id!=hidden.Id) && (await History(sarah,directId)).Single(m=>m.Id==hidden.Id).IsDeleted,
            "Shared deletion does not resurrect an already hidden message");

        var groupMessage=await Send(b,sarah,groupId,"Group admin can remove this");
        check((await History(alex,groupId)).Single(m=>m.Id==groupMessage.Id).CanDeleteForEveryone,
            "Group admins receive the shared-delete option for other members' messages");
        await a.InvokeAsync("DeleteMessage",groupMessage.Id);
        check((await History(sarah,groupId)).Single(m=>m.Id==groupMessage.Id).IsDeleted,"Group-admin deletion reaches the original sender");
        var info=await b.InvokeAsync<JsonElement>("GetMessageInfo",source.Id);
        check(info.GetProperty("senderName").GetString()==source.SenderName && info.TryGetProperty("readBy",out _),
            "Message information includes its sender, timestamp, and permitted read receipts");
    }
}
