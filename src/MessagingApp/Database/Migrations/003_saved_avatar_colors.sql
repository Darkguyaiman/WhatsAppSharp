ALTER TABLE `Users`
  ADD COLUMN `AvatarColor` varchar(7) NOT NULL DEFAULT '';

ALTER TABLE `Conversations`
  ADD COLUMN `AvatarColor` varchar(7) NOT NULL DEFAULT '';

UPDATE `Users`
SET `AvatarColor` = ELT(1 + FLOOR(RAND() * 10), '#075985', '#166534', '#6b21a8', '#9f1239', '#92400e', '#115e59', '#3730a3', '#7c2d12', '#334155', '#155e75');

UPDATE `Conversations`
SET `AvatarColor` = ELT(1 + FLOOR(RAND() * 10), '#075985', '#166534', '#6b21a8', '#9f1239', '#92400e', '#115e59', '#3730a3', '#7c2d12', '#334155', '#155e75');
