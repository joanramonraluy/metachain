/**
 * Services Index - Central export point for all MetaChain services
 * 
 * This file provides a unified import point for all services.
 * Use this for new code to benefit from the modular architecture.
 * 
 * MIGRATION GUIDE:
 * ================
 * OLD (from minima.service.ts):
 *   import { minimaService } from '../services/minima.service';
 *   minimaService.sendMessage(...);
 * 
 * NEW (from modular services):
 *   import { messagingService } from '../services';
 *   messagingService.sendMessage(...);
 * 
 * Or import specific functions:
 *   import { sendMessage, sendPing } from '../services/messaging.service';
 * 
 * SERVICE MAPPING:
 * ================
 * minimaService.hexToUtf8()         -> import { hexToUtf8 } from './database.service'
 * minimaService.utf8ToHex()         -> import { utf8ToHex } from './database.service'
 * minimaService.runSQL()            -> import { runSQL } from './database.service'
 * minimaService.initDB()            -> import { initDB } from './database.service'
 * 
 * minimaService.insertMessage()     -> chatService.insertMessage()
 * minimaService.getMessages()       -> chatService.getMessages()
 * minimaService.archiveChat()       -> chatService.archiveChat()
 * minimaService.muteContact()       -> chatService.muteContact()
 * minimaService.markChatAsFavorite() -> chatService.markChatAsFavorite()
 * 
 * minimaService.sendMessage()       -> messagingService.sendMessage()
 * minimaService.sendPing()          -> messagingService.sendPing()
 * minimaService.sendReadReceipt()   -> messagingService.sendReadReceipt()
 * 
 * minimaService.insertTransaction() -> transactionService.insertTransaction()
 * minimaService.getBalance()        -> transactionService.getBalance()
 * minimaService.sendToken()         -> transactionService.sendToken()
 */

// Database utilities
export { runSQL, hexToUtf8, utf8ToHex, escapeSql, initDB, resolveMaximaAddress } from './database.service';

// Chat management
export { chatService } from './chat.service';
export type { ChatMessage } from './chat.service';

// Messaging (Maxima)
export { messagingService } from './messaging.service';

// Transaction tracking
export { transactionService } from './transaction.service';

// Discovery
export { DiscoveryService as discoveryService } from './discovery.service';

// Profile
export { requestProfile, handleProfileResponse, cancelProfileRequest } from './profile.service';
export type { ExtendedProfile } from './profile.service';

// Groups
export { groupService } from './group.service';

// Personal contacts
export { personalContactsService } from './personal-contacts.service';

// Transaction polling
export { transactionPollingService } from './transaction-polling.service';

// Contact requests (Chat + Maxima)
export { contactRequestsService } from './contact-requests.service';

// Legacy: Keep minimaService export for backwards compatibility
// New code should import from specific services above
export { minimaService } from './minima.service';
