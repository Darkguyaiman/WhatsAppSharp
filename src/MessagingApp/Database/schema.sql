-- Full MessagingApp schema (current): creates the database and every table.
-- Incremental upgrades use Database/migrations/*.sql; keep this file in sync
-- when you add a migration. Default name matches MYSQL_DATABASE in example.env.

CREATE DATABASE IF NOT EXISTS `messagingapp_db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `messagingapp_db`;

CREATE TABLE `Users` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Username` varchar(50) NOT NULL,
  `Email` varchar(100) NOT NULL,
  `PasswordHash` longtext NOT NULL,
  `GoogleSubject` varchar(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `DisplayName` varchar(100) NOT NULL,
  `AvatarUrl` varchar(255) NULL,
  `AvatarColor` varchar(7) NOT NULL,
  `About` varchar(255) NULL,
  `CreatedAt` datetime(6) NOT NULL,
  `LastSeenAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `IX_Users_Email` (`Email`),
  UNIQUE KEY `IX_Users_Username` (`Username`),
  UNIQUE KEY `IX_Users_GoogleSubject` (`GoogleSubject`)
) CHARACTER SET utf8mb4;

CREATE TABLE `Conversations` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Title` varchar(100) NULL,
  `IsGroup` tinyint(1) NOT NULL,
  `AvatarColor` varchar(7) NOT NULL,
  `CreatedAt` datetime(6) NOT NULL,
  `UpdatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`)
) CHARACTER SET utf8mb4;

CREATE TABLE `ConversationMembers` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `ConversationId` int NOT NULL,
  `UserId` int NOT NULL,
  `JoinedAt` datetime(6) NOT NULL,
  `LastReadMessageId` int NULL,
  `LastReadAt` datetime(6) NULL,
  `IsAdmin` tinyint(1) NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `IX_ConversationMembers_ConversationId_UserId` (`ConversationId`, `UserId`),
  KEY `IX_ConversationMembers_UserId` (`UserId`),
  CONSTRAINT `FK_ConversationMembers_Conversations_ConversationId`
    FOREIGN KEY (`ConversationId`) REFERENCES `Conversations` (`Id`) ON DELETE CASCADE,
  CONSTRAINT `FK_ConversationMembers_Users_UserId`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE RESTRICT
) CHARACTER SET utf8mb4;

CREATE TABLE `Messages` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `ConversationId` int NOT NULL,
  `SenderId` int NOT NULL,
  `Content` longtext NULL,
  `Type` int NOT NULL,
  `AttachmentUrl` varchar(255) NULL,
  `AttachmentName` varchar(255) NULL,
  `AttachmentSize` bigint NULL,
  `ReplyToMessageId` int NULL,
  `IsEdited` tinyint(1) NOT NULL,
  `IsDeleted` tinyint(1) NOT NULL,
  `CreatedAt` datetime(6) NOT NULL,
  `UpdatedAt` datetime(6) NULL,
  PRIMARY KEY (`Id`),
  KEY `IX_Messages_ConversationId` (`ConversationId`),
  KEY `IX_Messages_ConversationId_Id` (`ConversationId`, `Id`),
  KEY `IX_Messages_CreatedAt` (`CreatedAt`),
  KEY `IX_Messages_ReplyToMessageId` (`ReplyToMessageId`),
  KEY `IX_Messages_SenderId` (`SenderId`),
  CONSTRAINT `FK_Messages_Conversations_ConversationId`
    FOREIGN KEY (`ConversationId`) REFERENCES `Conversations` (`Id`) ON DELETE CASCADE,
  CONSTRAINT `FK_Messages_Messages_ReplyToMessageId`
    FOREIGN KEY (`ReplyToMessageId`) REFERENCES `Messages` (`Id`) ON DELETE SET NULL,
  CONSTRAINT `FK_Messages_Users_SenderId`
    FOREIGN KEY (`SenderId`) REFERENCES `Users` (`Id`) ON DELETE RESTRICT
) CHARACTER SET utf8mb4;

CREATE TABLE `MessageReactions` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `MessageId` int NOT NULL,
  `UserId` int NOT NULL,
  `Emoji` varchar(16) NOT NULL,
  `CreatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `IX_MessageReactions_MessageId_UserId_Emoji` (`MessageId`, `UserId`, `Emoji`),
  KEY `IX_MessageReactions_UserId` (`UserId`),
  CONSTRAINT `FK_MessageReactions_Messages_MessageId`
    FOREIGN KEY (`MessageId`) REFERENCES `Messages` (`Id`) ON DELETE CASCADE,
  CONSTRAINT `FK_MessageReactions_Users_UserId`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE RESTRICT
) CHARACTER SET utf8mb4;

CREATE TABLE `MessageReads` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `MessageId` int NOT NULL,
  `UserId` int NOT NULL,
  `ReadAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `IX_MessageReads_MessageId_UserId` (`MessageId`, `UserId`),
  KEY `IX_MessageReads_UserId` (`UserId`),
  CONSTRAINT `FK_MessageReads_Messages_MessageId`
    FOREIGN KEY (`MessageId`) REFERENCES `Messages` (`Id`) ON DELETE CASCADE,
  CONSTRAINT `FK_MessageReads_Users_UserId`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE RESTRICT
) CHARACTER SET utf8mb4;

CREATE TABLE `WebPushSubscriptions` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `UserId` int NOT NULL,
  `Endpoint` varchar(2048) NOT NULL,
  `EndpointHash` varchar(64) NOT NULL,
  `P256dh` varchar(128) NOT NULL,
  `Auth` varchar(64) NOT NULL,
  `UpdatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `IX_WebPushSubscriptions_EndpointHash` (`EndpointHash`),
  KEY `IX_WebPushSubscriptions_UserId` (`UserId`),
  CONSTRAINT `FK_WebPushSubscriptions_Users_UserId`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE TABLE `__SchemaMigrations` (
  `Id` varchar(255) NOT NULL,
  `AppliedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`)
) CHARACTER SET utf8mb4;

-- The full schema already contains these migrations. Record them so startup
-- does not attempt to recreate imported tables.
INSERT INTO `__SchemaMigrations` (`Id`, `AppliedAt`) VALUES
  ('001_initial_create.sql', UTC_TIMESTAMP(6)),
  ('002_web_push_and_message_paging.sql', UTC_TIMESTAMP(6)),
  ('003_saved_avatar_colors.sql', UTC_TIMESTAMP(6)),
  ('004_google_accounts.sql', UTC_TIMESTAMP(6));

CREATE TABLE `Communities` (
  `Id` int NOT NULL AUTO_INCREMENT, `Title` varchar(100) NOT NULL,
  `Description` varchar(500) NOT NULL, `CreatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`)
) CHARACTER SET utf8mb4;
CREATE TABLE `CommunityMembers` (
  `Id` int NOT NULL AUTO_INCREMENT, `CommunityId` int NOT NULL,
  `UserId` int NOT NULL, `IsAdmin` tinyint(1) NOT NULL,
  PRIMARY KEY (`Id`), UNIQUE KEY `IX_CommunityMembers_CommunityId_UserId` (`CommunityId`,`UserId`),
  KEY `IX_CommunityMembers_UserId` (`UserId`),
  FOREIGN KEY (`CommunityId`) REFERENCES `Communities` (`Id`) ON DELETE CASCADE,
  FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;
ALTER TABLE `Conversations` ADD COLUMN `CommunityId` int NULL, ADD COLUMN `IsAnnouncement` tinyint(1) NOT NULL DEFAULT 0,
  ADD INDEX `IX_Conversations_CommunityId` (`CommunityId`),
  ADD FOREIGN KEY (`CommunityId`) REFERENCES `Communities` (`Id`) ON DELETE SET NULL;
CREATE TABLE `StatusPosts` (
  `Id` int NOT NULL AUTO_INCREMENT, `UserId` int NOT NULL, `Text` varchar(700) NOT NULL,
  `ImageUrl` varchar(255) NULL, `Color` varchar(7) NOT NULL, `Style` varchar(255) NOT NULL,
  `CreatedAt` datetime(6) NOT NULL, `ExpiresAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`), KEY `IX_StatusPosts_ExpiresAt` (`ExpiresAt`), KEY `IX_StatusPosts_UserId` (`UserId`),
  FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;
CREATE TABLE `StatusViews` (
  `Id` int NOT NULL AUTO_INCREMENT, `StatusPostId` int NOT NULL, `UserId` int NOT NULL,
  `ViewedAt` datetime(6) NOT NULL, PRIMARY KEY (`Id`),
  UNIQUE KEY `IX_StatusViews_StatusPostId_UserId` (`StatusPostId`,`UserId`),
  FOREIGN KEY (`StatusPostId`) REFERENCES `StatusPosts` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;
CREATE TABLE `CallRecords` (
  `Id` varchar(32) NOT NULL, `ConversationId` int NOT NULL, `CallerId` int NOT NULL,
  `RecipientId` int NOT NULL, `Video` tinyint(1) NOT NULL, `State` varchar(20) NOT NULL,
  `CreatedAt` datetime(6) NOT NULL, `AnsweredAt` datetime(6) NULL, `EndedAt` datetime(6) NULL,
  PRIMARY KEY (`Id`), KEY `IX_CallRecords_CallerId_CreatedAt` (`CallerId`,`CreatedAt`),
  KEY `IX_CallRecords_RecipientId_CreatedAt` (`RecipientId`,`CreatedAt`)
) CHARACTER SET utf8mb4;

INSERT INTO `__SchemaMigrations` (`Id`, `AppliedAt`) VALUES ('005_social_and_calls.sql', UTC_TIMESTAMP(6));
INSERT INTO `__SchemaMigrations` (`Id`, `AppliedAt`) VALUES ('006_status_style.sql', UTC_TIMESTAMP(6));


ALTER TABLE `Messages` ADD COLUMN `IsForwarded` tinyint(1) NOT NULL DEFAULT 0;
ALTER TABLE `MessageReactions` MODIFY COLUMN `Emoji` varchar(64) NOT NULL;
CREATE TABLE `MessageUserStates` (
  `MessageId` int NOT NULL, `UserId` int NOT NULL,
  `IsHidden` tinyint(1) NOT NULL DEFAULT 0, `IsStarred` tinyint(1) NOT NULL DEFAULT 0,
  `Note` varchar(5000) NULL,
  PRIMARY KEY (`MessageId`, `UserId`), KEY `IX_MessageUserStates_UserId_IsStarred` (`UserId`,`IsStarred`),
  FOREIGN KEY (`MessageId`) REFERENCES `Messages` (`Id`) ON DELETE CASCADE,
  FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;
CREATE TABLE `MessagePins` (
  `MessageId` int NOT NULL, `ConversationId` int NOT NULL, `PinnedByUserId` int NOT NULL,
  `ExpiresAt` datetime(6) NOT NULL, PRIMARY KEY (`MessageId`),
  KEY `IX_MessagePins_ConversationId_ExpiresAt` (`ConversationId`,`ExpiresAt`),
  FOREIGN KEY (`MessageId`) REFERENCES `Messages` (`Id`) ON DELETE CASCADE,
  FOREIGN KEY (`ConversationId`) REFERENCES `Conversations` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

INSERT INTO `__SchemaMigrations` (`Id`, `AppliedAt`) VALUES ('007_message_actions.sql', UTC_TIMESTAMP(6));

-- Keep the most recent selection when upgrading older multi-reaction messages.
DELETE older FROM `MessageReactions` older
JOIN `MessageReactions` newer ON newer.`MessageId` = older.`MessageId` AND newer.`UserId` = older.`UserId`
  AND (newer.`CreatedAt` > older.`CreatedAt` OR (newer.`CreatedAt` = older.`CreatedAt` AND newer.`Id` > older.`Id`));
ALTER TABLE `MessageReactions`
  DROP INDEX `IX_MessageReactions_MessageId_UserId_Emoji`,
  ADD UNIQUE INDEX `IX_MessageReactions_MessageId_UserId` (`MessageId`,`UserId`);
INSERT INTO `__SchemaMigrations` (`Id`, `AppliedAt`) VALUES ('008_one_reaction_per_person.sql', UTC_TIMESTAMP(6));

CREATE TABLE `MessageDeliveries` (
  `MessageId` int NOT NULL, `UserId` int NOT NULL, `DeliveredAt` datetime(6) NOT NULL,
  PRIMARY KEY (`MessageId`,`UserId`), KEY `IX_MessageDeliveries_UserId` (`UserId`),
  FOREIGN KEY (`MessageId`) REFERENCES `Messages` (`Id`) ON DELETE CASCADE,
  FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE RESTRICT
) CHARACTER SET utf8mb4;
INSERT INTO `MessageDeliveries` (`MessageId`,`UserId`,`DeliveredAt`)
SELECT r.`MessageId`,r.`UserId`,r.`ReadAt` FROM `MessageReads` r
JOIN `Messages` m ON m.`Id`=r.`MessageId` WHERE r.`UserId`<>m.`SenderId`;
INSERT INTO `__SchemaMigrations` (`Id`, `AppliedAt`) VALUES ('009_delivery_receipts.sql', UTC_TIMESTAMP(6));
