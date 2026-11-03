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
