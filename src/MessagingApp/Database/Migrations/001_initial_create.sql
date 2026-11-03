CREATE TABLE `Conversations` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Title` varchar(100) NULL,
  `IsGroup` tinyint(1) NOT NULL,
  `CreatedAt` datetime(6) NOT NULL,
  `UpdatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`)
) CHARACTER SET utf8mb4;

CREATE TABLE `Users` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Username` varchar(50) NOT NULL,
  `Email` varchar(100) NOT NULL,
  `PasswordHash` longtext NOT NULL,
  `DisplayName` varchar(100) NOT NULL,
  `AvatarUrl` varchar(255) NULL,
  `About` varchar(255) NULL,
  `CreatedAt` datetime(6) NOT NULL,
  `LastSeenAt` datetime(6) NOT NULL,
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
  CONSTRAINT `FK_MessageReads_Messages_MessageId`
    FOREIGN KEY (`MessageId`) REFERENCES `Messages` (`Id`) ON DELETE CASCADE,
  CONSTRAINT `FK_MessageReads_Users_UserId`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE RESTRICT
) CHARACTER SET utf8mb4;

CREATE UNIQUE INDEX `IX_ConversationMembers_ConversationId_UserId`
  ON `ConversationMembers` (`ConversationId`, `UserId`);
CREATE INDEX `IX_ConversationMembers_UserId` ON `ConversationMembers` (`UserId`);

CREATE UNIQUE INDEX `IX_MessageReactions_MessageId_UserId_Emoji`
  ON `MessageReactions` (`MessageId`, `UserId`, `Emoji`);
CREATE INDEX `IX_MessageReactions_UserId` ON `MessageReactions` (`UserId`);

CREATE UNIQUE INDEX `IX_MessageReads_MessageId_UserId`
  ON `MessageReads` (`MessageId`, `UserId`);
CREATE INDEX `IX_MessageReads_UserId` ON `MessageReads` (`UserId`);

CREATE INDEX `IX_Messages_ConversationId` ON `Messages` (`ConversationId`);
CREATE INDEX `IX_Messages_CreatedAt` ON `Messages` (`CreatedAt`);
CREATE INDEX `IX_Messages_ReplyToMessageId` ON `Messages` (`ReplyToMessageId`);
CREATE INDEX `IX_Messages_SenderId` ON `Messages` (`SenderId`);

CREATE UNIQUE INDEX `IX_Users_Email` ON `Users` (`Email`);
CREATE UNIQUE INDEX `IX_Users_Username` ON `Users` (`Username`);
