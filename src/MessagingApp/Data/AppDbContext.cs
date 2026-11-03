using Microsoft.EntityFrameworkCore;
using MessagingApp.Models;

namespace MessagingApp.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationMember> ConversationMembers => Set<ConversationMember>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageReaction> MessageReactions => Set<MessageReaction>();
    public DbSet<MessageRead> MessageReads => Set<MessageRead>();
    public DbSet<MessageDelivery> MessageDeliveries => Set<MessageDelivery>();
    public DbSet<MessageUserState> MessageUserStates => Set<MessageUserState>();
    public DbSet<MessagePin> MessagePins => Set<MessagePin>();
    public DbSet<WebPushSubscription> WebPushSubscriptions => Set<WebPushSubscription>();
    public DbSet<Community> Communities => Set<Community>();
    public DbSet<CommunityMember> CommunityMembers => Set<CommunityMember>();
    public DbSet<StatusPost> StatusPosts => Set<StatusPost>();
    public DbSet<StatusView> StatusViews => Set<StatusView>();
    public DbSet<CallRecord> CallRecords => Set<CallRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.Entity<MessageUserState>(entity =>
        {
            entity.HasKey(s => new { s.MessageId, s.UserId });
            entity.Property(s => s.Note).HasMaxLength(5000);
            entity.HasIndex(s => new { s.UserId, s.IsStarred });
            entity.HasOne(s => s.Message).WithMany(m => m.UserStates).HasForeignKey(s => s.MessageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<User>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<MessagePin>(entity =>
        {
            entity.HasKey(p => p.MessageId);
            entity.HasIndex(p => new { p.ConversationId, p.ExpiresAt });
            entity.HasOne(p => p.Message).WithMany().HasForeignKey(p => p.MessageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Conversation>().WithMany().HasForeignKey(p => p.ConversationId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<CommunityMember>(entity =>
        {
            entity.HasIndex(m => new { m.CommunityId, m.UserId }).IsUnique();
            entity.HasOne(m => m.Community).WithMany(c => c.Members).HasForeignKey(m => m.CommunityId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<Conversation>().HasOne(c => c.Community).WithMany().HasForeignKey(c => c.CommunityId).OnDelete(DeleteBehavior.SetNull);
        modelBuilder.Entity<StatusPost>(entity =>
        {
            entity.HasIndex(s => s.ExpiresAt);
            entity.HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<StatusView>(entity =>
        {
            entity.HasIndex(v => new { v.StatusPostId, v.UserId }).IsUnique();
            entity.HasOne(v => v.StatusPost).WithMany(s => s.Views).HasForeignKey(v => v.StatusPostId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<CallRecord>().HasIndex(c => new { c.CallerId, c.CreatedAt });
        modelBuilder.Entity<CallRecord>().HasIndex(c => new { c.RecipientId, c.CreatedAt });
        modelBuilder.Entity<WebPushSubscription>(entity =>
        {
            entity.HasIndex(s => s.EndpointHash).IsUnique();
            entity.HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        // User indexes
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(u => u.Username).IsUnique();
            entity.HasIndex(u => u.Email).IsUnique();
            entity.HasIndex(u => u.GoogleSubject).IsUnique();
        });

        // ConversationMember
        modelBuilder.Entity<ConversationMember>(entity =>
        {
            entity.HasIndex(cm => new { cm.ConversationId, cm.UserId }).IsUnique();

            entity.HasOne(cm => cm.Conversation)
                .WithMany(c => c.Members)
                .HasForeignKey(cm => cm.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(cm => cm.User)
                .WithMany(u => u.Memberships)
                .HasForeignKey(cm => cm.UserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // Message
        modelBuilder.Entity<Message>(entity =>
        {
            entity.HasIndex(m => m.ConversationId);
            entity.HasIndex(m => new { m.ConversationId, m.Id });
            entity.HasIndex(m => m.SenderId);
            entity.HasIndex(m => m.CreatedAt);

            entity.HasOne(m => m.Conversation)
                .WithMany(c => c.Messages)
                .HasForeignKey(m => m.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(m => m.Sender)
                .WithMany(u => u.Messages)
                .HasForeignKey(m => m.SenderId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(m => m.ReplyToMessage)
                .WithMany()
                .HasForeignKey(m => m.ReplyToMessageId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // MessageReaction
        modelBuilder.Entity<MessageReaction>(entity =>
        {
            entity.HasIndex(mr => new { mr.MessageId, mr.UserId }).IsUnique();

            entity.HasOne(mr => mr.Message)
                .WithMany(m => m.Reactions)
                .HasForeignKey(mr => mr.MessageId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(mr => mr.User)
                .WithMany(u => u.Reactions)
                .HasForeignKey(mr => mr.UserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<MessageDelivery>(entity =>
        {
            entity.HasKey(r => new { r.MessageId, r.UserId });
            entity.HasIndex(r => r.UserId);
            entity.HasOne(r => r.Message).WithMany(m => m.Deliveries)
                .HasForeignKey(r => r.MessageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<User>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        // MessageRead
        modelBuilder.Entity<MessageRead>(entity =>
        {
            entity.HasIndex(mr => new { mr.MessageId, mr.UserId }).IsUnique();

            entity.HasOne(mr => mr.Message)
                .WithMany(m => m.Reads)
                .HasForeignKey(mr => mr.MessageId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(mr => mr.User)
                .WithMany(u => u.Reads)
                .HasForeignKey(mr => mr.UserId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
