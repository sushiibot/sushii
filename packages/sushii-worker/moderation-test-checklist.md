# Moderation Actions QA Test Checklist

## Basic Command Testing

### `/ban` Command
- [ ] Ban single user: `/ban users:@user reason:"Test ban"`
- [ ] Ban with message deletion: `/ban users:@user days_to_delete:7 reason:"Spam"`
- [ ] Ban with DM options: `/ban users:@user dm_reason:yes_dm`
- [ ] Ban multiple users: `/ban users:"@user1 @user2" reason:"Mass action"`
- [ ] Ban by user ID: `/ban users:123456789012345678`
- [x] Deletes DM on ban failure

### `/tempban` Command
- [x] Tempban with duration: `/tempban users:@user duration:1h reason:"Test"`
- [x] Tempban with invalid duration: `/tempban users:@user duration:invalid`

### `/kick` Command
- [x] Kick single user: `/kick users:@user reason:"Test"`
- [ ] Kick multiple users: `/kick users:"@user1 @user2"`
- [x] Kick permission validation
- [x] Kick hierarchy validation

### `/timeout` Command
- [x] Timeout with duration: `/timeout users:@user duration:1h`
- [x] Timeout with invalid duration (should fail): `/timeout users:@user`
- [x] Timeout duration limits (Discord's 28-day max)
- [x] Native timeout DM handling

### `/warn` Command
- [x] Warn with reason (required): `/warn users:@user reason:"Test"`
- [x] Warning with required reason

### `/note` Command
- [x] Add note: `/note users:@user note:"Test note"`
- [x] Staff note (no DM)

### `/unban` Command
- [x] Unban user: `/unban users:123456789012345678 reason:"Test"`
- [x] Unban user not banned (should handle gracefully)

### `/untimeout` Command
- [x] Remove timeout: `/untimeout users:@user reason:"Test"`
- [x] Untimeout non-timed-out user (should handle gracefully)

## Error Handling

### User & Permission Validation
- [x] Invalid user ID: `/ban users:invalid_id`
- [x] Execute without proper permissions (should fail)
- [ ] Execute on higher role users (should fail)
- [x] Execute on bot itself (should fail)

## Response & DM Validation

### Response Quality
- [x] Success messages contain correct user information
- [x] Error messages are clear and helpful

### DM Functionality
- [x] Verify DMs sent when `dm_reason:yes_dm`
- [x] Confirm no DMs when `dm_reason:no_dm`
- [x] DM content includes reason and server information
- [x] Guild default DM settings
- [x] DM deletion via mod log button
- [x] Standard DM templates
- [x] Custom guild DM messages

## Integration Testing

### Sequential Actions
- [x] Ban then unban the same user
- [x] Timeout then untimeout the same user

## History & Lookup Commands

### History Commands
- [x] `/history user:<user>` - View user's moderation history
- [x] `/history user_id:<id>` - History by user ID
- [ ] History pagination (if many cases)
- [x] Context menu "User Lookup" command

### Lookup Commands
- [x] `/lookup user:<user>` - User information lookup
- [x] Lookup with user not in server
- [x] Lookup showing join date, account age, roles, etc.

## Mod Log System

### Automatic Logging
- [x] Ban actions logged to mod log channel
- [x] Kick actions logged
- [x] Timeout actions logged
- [x] Warning actions logged
- [x] Manual actions vs Discord audit log detection
- [x] Native timeout detection and DM handling

### Mod Log Components
- [x] "Delete DM" button functionality
- [x] Mod log embed formatting
- [x] Attachment display in mod logs
- [x] Case number assignment and display

## Message Management

### `/prune` Command
- [ ] Basic prune: `/prune max_delete_count:10`
- [ ] Prune with user filter: `/prune max_delete_count:10 user:@user`
- [ ] Prune with message ID filter: `/prune max_delete_count:10 after_message_id:123456789012345678`
- [ ] Prune with attachment filter: `/prune max_delete_count:10 attachments:"with_attachments"`
- [ ] Prune with invalid count (should fail): `/prune max_delete_count:1`
- [ ] Prune permission validation (Manage Messages)

### `/slowmode` Command
- [x] Set channel slowmode: `/slowmode duration:5s`
- [x] Disable slowmode: `/slowmode duration:0`
- [x] Slowmode in specific channel: `/slowmode duration:30s channel:#channel`
- [x] Slowmode with invalid durations
- [x] Slowmode permission validation (Manage Channels)

### `/tempban-list` Command
- [x] List active tempbans (when none exist)
- [x] List active tempbans (when some exist)
- [x] Tempban list permission validation (Ban Members)
