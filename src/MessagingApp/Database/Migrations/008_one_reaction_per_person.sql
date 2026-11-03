-- Keep the most recent selection when upgrading older multi-reaction messages.
DELETE older FROM `MessageReactions` older
JOIN `MessageReactions` newer ON newer.`MessageId` = older.`MessageId` AND newer.`UserId` = older.`UserId`
  AND (newer.`CreatedAt` > older.`CreatedAt` OR (newer.`CreatedAt` = older.`CreatedAt` AND newer.`Id` > older.`Id`));
ALTER TABLE `MessageReactions`
  DROP INDEX `IX_MessageReactions_MessageId_UserId_Emoji`,
  ADD UNIQUE INDEX `IX_MessageReactions_MessageId_UserId` (`MessageId`,`UserId`);
