using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Models;

namespace MessagingApp.Data;

public static class TestFixtures
{
    public static async Task SeedAsync(AppDbContext context, bool seedDemoUsers = true)
    {
        await SqlMigrationRunner.MigrateAsync(context.Database.GetConnectionString()
            ?? throw new InvalidOperationException("Database connection string is missing."));
        if (!seedDemoUsers) return;

        if (await context.Users.AnyAsync())
        {
            return; // Already seeded
        }

        var hasher = new PasswordHasher<User>();

        var userAlex = new User
        {
            Username = "alex",
            Email = "alex@example.com",
            DisplayName = "Alex Morgan",
            About = "Hey there! I am using WhatsApp Web.",
            AvatarUrl = "/images/avatars/avatar-alex.svg",
            CreatedAt = DateTime.UtcNow.AddMonths(-2),
            LastSeenAt = DateTime.UtcNow
        };
        userAlex.PasswordHash = hasher.HashPassword(userAlex, "Password123!");

        var userSarah = new User
        {
            Username = "sarah",
            Email = "sarah@example.com",
            DisplayName = "Sarah Connor",
            About = "Busy saving the future 🤖",
            AvatarUrl = "/images/avatars/avatar-sarah.svg",
            CreatedAt = DateTime.UtcNow.AddMonths(-2),
            LastSeenAt = DateTime.UtcNow.AddMinutes(-5)
        };
        userSarah.PasswordHash = hasher.HashPassword(userSarah, "Password123!");

        var userJohn = new User
        {
            Username = "john",
            Email = "john@example.com",
            DisplayName = "John Doe",
            About = "Coffee & Code ☕💻",
            AvatarUrl = "/images/avatars/avatar-john.svg",
            CreatedAt = DateTime.UtcNow.AddMonths(-1),
            LastSeenAt = DateTime.UtcNow.AddMinutes(-20)
        };
        userJohn.PasswordHash = hasher.HashPassword(userJohn, "Password123!");

        var userEmma = new User
        {
            Username = "emma",
            Email = "emma@example.com",
            DisplayName = "Emma Watson",
            About = "At the movies 🎬✨",
            AvatarUrl = "/images/avatars/avatar-emma.svg",
            CreatedAt = DateTime.UtcNow.AddMonths(-1),
            LastSeenAt = DateTime.UtcNow.AddHours(-2)
        };
        userEmma.PasswordHash = hasher.HashPassword(userEmma, "Password123!");

        var userDavid = new User
        {
            Username = "david",
            Email = "david@example.com",
            DisplayName = "David Beckham",
            About = "Family & Football ⚽",
            AvatarUrl = "/images/avatars/avatar-david.svg",
            CreatedAt = DateTime.UtcNow.AddMonths(-1),
            LastSeenAt = DateTime.UtcNow.AddDays(-1)
        };
        userDavid.PasswordHash = hasher.HashPassword(userDavid, "Password123!");

        context.Users.AddRange(userAlex, userSarah, userJohn, userEmma, userDavid);
        await context.SaveChangesAsync();

        // 1. Pre-seeded Conversation: Alex & Sarah
        var convAlexSarah = new Conversation
        {
            IsGroup = false,
            CreatedAt = DateTime.UtcNow.AddDays(-3),
            UpdatedAt = DateTime.UtcNow.AddMinutes(-12)
        };
        context.Conversations.Add(convAlexSarah);
        await context.SaveChangesAsync();

        context.ConversationMembers.AddRange(
            new ConversationMember { ConversationId = convAlexSarah.Id, UserId = userAlex.Id, JoinedAt = convAlexSarah.CreatedAt },
            new ConversationMember { ConversationId = convAlexSarah.Id, UserId = userSarah.Id, JoinedAt = convAlexSarah.CreatedAt }
        );
        await context.SaveChangesAsync();

        // Messages between Alex and Sarah
        var m1 = new Message
        {
            ConversationId = convAlexSarah.Id,
            SenderId = userSarah.Id,
            Content = "Hey Alex! Did you get a chance to check the new UI design for the messaging app?",
            Type = MessageType.Text,
            CreatedAt = DateTime.UtcNow.AddMinutes(-45)
        };
        context.Messages.Add(m1);
        await context.SaveChangesAsync();

        var m2 = new Message
        {
            ConversationId = convAlexSarah.Id,
            SenderId = userAlex.Id,
            Content = "Hey Sarah! Yes, I just looked at it. The WhatsApp Web layout looks stunning!",
            Type = MessageType.Text,
            ReplyToMessageId = m1.Id,
            CreatedAt = DateTime.UtcNow.AddMinutes(-30)
        };
        context.Messages.Add(m2);
        await context.SaveChangesAsync();

        var m3 = new Message
        {
            ConversationId = convAlexSarah.Id,
            SenderId = userSarah.Id,
            Content = "Awesome! SignalR real-time messaging, typing indicators, and reactions make it feel super responsive 🔥",
            Type = MessageType.Text,
            CreatedAt = DateTime.UtcNow.AddMinutes(-15)
        };
        context.Messages.Add(m3);
        await context.SaveChangesAsync();

        var m4 = new Message
        {
            ConversationId = convAlexSarah.Id,
            SenderId = userAlex.Id,
            Content = "Let's do a quick live test right now!",
            Type = MessageType.Text,
            CreatedAt = DateTime.UtcNow.AddMinutes(-12)
        };
        context.Messages.Add(m4);
        await context.SaveChangesAsync();

        // Add some reactions
        context.MessageReactions.Add(new MessageReaction
        {
            MessageId = m3.Id,
            UserId = userAlex.Id,
            Emoji = "👍",
            CreatedAt = DateTime.UtcNow.AddMinutes(-14)
        });
        context.MessageReactions.Add(new MessageReaction
        {
            MessageId = m3.Id,
            UserId = userSarah.Id,
            Emoji = "❤️",
            CreatedAt = DateTime.UtcNow.AddMinutes(-13)
        });

        // Mark reads
        context.MessageReads.Add(new MessageRead { MessageId = m1.Id, UserId = userAlex.Id, ReadAt = DateTime.UtcNow.AddMinutes(-40) });
        context.MessageReads.Add(new MessageRead { MessageId = m2.Id, UserId = userSarah.Id, ReadAt = DateTime.UtcNow.AddMinutes(-25) });
        context.MessageReads.Add(new MessageRead { MessageId = m3.Id, UserId = userAlex.Id, ReadAt = DateTime.UtcNow.AddMinutes(-14) });

        // 2. Pre-seeded Conversation: Alex & John
        var convAlexJohn = new Conversation
        {
            IsGroup = false,
            CreatedAt = DateTime.UtcNow.AddDays(-2),
            UpdatedAt = DateTime.UtcNow.AddHours(-3)
        };
        context.Conversations.Add(convAlexJohn);
        await context.SaveChangesAsync();

        context.ConversationMembers.AddRange(
            new ConversationMember { ConversationId = convAlexJohn.Id, UserId = userAlex.Id, JoinedAt = convAlexJohn.CreatedAt },
            new ConversationMember { ConversationId = convAlexJohn.Id, UserId = userJohn.Id, JoinedAt = convAlexJohn.CreatedAt }
        );
        await context.SaveChangesAsync();

        var mj1 = new Message
        {
            ConversationId = convAlexJohn.Id,
            SenderId = userJohn.Id,
            Content = "Morning Alex, are we still meeting for coffee at 2 PM?",
            Type = MessageType.Text,
            CreatedAt = DateTime.UtcNow.AddHours(-3)
        };
        context.Messages.Add(mj1);
        await context.SaveChangesAsync();

        // 3. Pre-seeded Conversation: Alex & Emma
        var convAlexEmma = new Conversation
        {
            IsGroup = false,
            CreatedAt = DateTime.UtcNow.AddDays(-1),
            UpdatedAt = DateTime.UtcNow.AddHours(-5)
        };
        context.Conversations.Add(convAlexEmma);
        await context.SaveChangesAsync();

        context.ConversationMembers.AddRange(
            new ConversationMember { ConversationId = convAlexEmma.Id, UserId = userAlex.Id, JoinedAt = convAlexEmma.CreatedAt },
            new ConversationMember { ConversationId = convAlexEmma.Id, UserId = userEmma.Id, JoinedAt = convAlexEmma.CreatedAt }
        );
        await context.SaveChangesAsync();

        var me1 = new Message
        {
            ConversationId = convAlexEmma.Id,
            SenderId = userEmma.Id,
            Content = "Check out this photo from the premiere yesterday!",
            Type = MessageType.Text,
            CreatedAt = DateTime.UtcNow.AddHours(-5)
        };
        context.Messages.Add(me1);
        await context.SaveChangesAsync();

        // 4. Pre-seeded Group: Team Chat
        var convGroup = new Conversation
        {
            Title = "Engineering Team 🚀",
            IsGroup = true,
            CreatedAt = DateTime.UtcNow.AddDays(-5),
            UpdatedAt = DateTime.UtcNow.AddHours(-1)
        };
        context.Conversations.Add(convGroup);
        await context.SaveChangesAsync();

        context.ConversationMembers.AddRange(
            new ConversationMember { ConversationId = convGroup.Id, UserId = userAlex.Id, JoinedAt = convGroup.CreatedAt, IsAdmin = true },
            new ConversationMember { ConversationId = convGroup.Id, UserId = userSarah.Id, JoinedAt = convGroup.CreatedAt },
            new ConversationMember { ConversationId = convGroup.Id, UserId = userJohn.Id, JoinedAt = convGroup.CreatedAt },
            new ConversationMember { ConversationId = convGroup.Id, UserId = userEmma.Id, JoinedAt = convGroup.CreatedAt }
        );
        await context.SaveChangesAsync();

        var mg1 = new Message
        {
            ConversationId = convGroup.Id,
            SenderId = userSarah.Id,
            Content = "Welcome to the Engineering chat! All real-time updates will be announced here.",
            Type = MessageType.Text,
            CreatedAt = DateTime.UtcNow.AddHours(-1)
        };
        context.Messages.Add(mg1);
        await context.SaveChangesAsync();

        // Update last message read status on members
        var memAlexSarah = await context.ConversationMembers.FirstOrDefaultAsync(cm => cm.ConversationId == convAlexSarah.Id && cm.UserId == userAlex.Id);
        if (memAlexSarah != null)
        {
            memAlexSarah.LastReadMessageId = m3.Id;
            memAlexSarah.LastReadAt = DateTime.UtcNow;
        }
        await context.SaveChangesAsync();
    }
}

