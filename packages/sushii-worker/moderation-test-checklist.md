# Moderation Actions QA Test Checklist

## Basic Command Testing

### `/ban` Command
- [ ] Ban single user: `/ban users:@user reason:"Test ban"`
- [ ] Ban with message deletion: `/ban users:@user days_to_delete:7 reason:"Spam"`
- [ ] Ban with DM options: `/ban users:@user dm_reason:yes_dm`
- [ ] Ban multiple users: `/ban users:"@user1 @user2" reason:"Mass action"`
- [ ] Ban by user ID: `/ban users:123456789012345678`

### `/tempban` Command
- [ ] Tempban with duration: `/tempban users:@user duration:1h reason:"Test"`
- [ ] Tempban without duration (should fail): `/tempban users:@user reason:"Test"`
- [ ] Tempban with invalid duration: `/tempban users:@user duration:invalid`

### `/kick` Command
- [ ] Kick single user: `/kick users:@user reason:"Test"`
- [ ] Kick multiple users: `/kick users:"@user1 @user2"`
- [x] Kick permission validation
- [x] Kick hierarchy validation

### `/timeout` Command
- [x] Timeout with duration: `/timeout users:@user duration:1h`
- [ ] Timeout without duration (should fail): `/timeout users:@user`
- [ ] Timeout exceeding Discord limit (should fail): `/timeout users:@user duration:30d`
- [x] Timeout duration limits (Discord's 28-day max)
- [x] Native timeout DM handling

### `/warn` Command
- [x] Warn with reason (required): `/warn users:@user reason:"Test"`
- [ ] Warn without reason (should fail): `/warn users:@user`
- [x] Warning with required reason

### `/note` Command
- [ ] Add note: `/note users:@user note:"Test note"`
- [ ] Note without content (should fail): `/note users:@user`
- [x] Staff note (no DM)

### `/unban` Command
- [ ] Unban user: `/unban users:123456789012345678 reason:"Test"`
- [x] Unban user not banned (should handle gracefully)
- [ ] Unban permission validation

### `/untimeout` Command
- [ ] Remove timeout: `/untimeout users:@user reason:"Test"`
- [ ] Untimeout non-timed-out user (should handle gracefully)

## Error Handling

### User & Permission Validation
- [ ] Invalid user ID: `/ban users:invalid_id`
- [ ] Execute without proper permissions (should fail)
- [ ] Execute on higher role users (should fail)
- [ ] Execute on bot itself (should fail)

### Input Validation
- [ ] Invalid duration format: `/timeout users:@user duration:invalid`
- [ ] Very long reasons (test character limits)
- [ ] Attachment with various file types

## Response & DM Validation

### Response Quality
- [ ] Success messages contain correct user information
- [ ] Error messages are clear and helpful

### DM Functionality
- [ ] Verify DMs sent when `dm_reason:yes_dm`
- [ ] Confirm no DMs when `dm_reason:no_dm`
- [ ] DM content includes reason and server information
- [x] Guild default DM settings
- [x] DM deletion via mod log button
- [x] Standard DM templates
- [x] Custom guild DM messages

## Integration Testing

### Sequential Actions
- [ ] Ban then unban the same user
- [ ] Timeout then untimeout the same user

### State Verification
- [ ] Banned users appear in server ban list
- [ ] Timed-out users show timeout status
- [ ] Unbanned users can rejoin server

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
- [ ] Ban actions logged to mod log channel
- [ ] Kick actions logged
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
- [ ] List active tempbans (when none exist)
- [ ] List active tempbans (when some exist)
- [ ] Tempban list permission validation (Ban Members)
