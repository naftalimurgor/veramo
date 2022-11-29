import { IAgentContext, IDIDManager, IKeyManager } from '@veramo/core'
import { AbstractMessageHandler, Message } from '@veramo/message-handler'
import Debug from 'debug'
import { v4 } from 'uuid'
import { IDIDComm } from '../types/IDIDComm'
import { IDIDCommMessage } from '../types/message-types'

const debug = Debug('veramo:did-comm:trust-ping-message-handler')

type IContext = IAgentContext<IDIDManager & IKeyManager & IDIDComm>

const TRUST_PING_MESSAGE_TYPE = 'https://didcomm.org/trust-ping/2.0/ping'
const TRUST_PING_RESPONSE_MESSAGE_TYPE = 'https://didcomm.org/trust-ping/2.0/ping-response'

export function createTrustPingMessage(senderDidUrl: string, recipientDidUrl: string): IDIDCommMessage {
  return {
    type: TRUST_PING_MESSAGE_TYPE,
    from: senderDidUrl,
    to: recipientDidUrl,
    id: v4(),
    body: {
      responseRequested: true
    }
  }
}

export function createTrustPingResponse(senderDidUrl: string, recipientDidUrl: string, pingId: string): IDIDCommMessage {
  return {
    type: TRUST_PING_RESPONSE_MESSAGE_TYPE,
    from: senderDidUrl,
    to: recipientDidUrl,
    id: v4(),
    thid: pingId,
    body: {}
  }
}

/**
 * A plugin for the {@link @veramo/message-handler#MessageHandler} that handles Trust Ping messages.
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export class TrustPingMessageHandler extends AbstractMessageHandler {
  constructor() {
    super()
  }

  /**
   * Handles a Trust Ping Message
   * https://identity.foundation/didcomm-messaging/spec/#trust-ping-protocol-10
   */
  async handle(message: Message, context: IContext): Promise<Message> {
    const parsedMessage = JSON.parse(message.raw!)
    console.log("handle message: ", parsedMessage)
    if (parsedMessage.type === TRUST_PING_MESSAGE_TYPE) {
      debug('TrustPing Message Received')
      try {
        const { from, to, id } = parsedMessage
        const response = createTrustPingResponse(to, from, id)
        const packedResponse = await context.agent.packDIDCommMessage({ message: response, packing: 'none'})
        const sent = await context.agent.sendDIDCommMessage({
          messageId: response.id,
          packedMessage: packedResponse,
          recipientDidUrl: parsedMessage.from,
        })
        message.addMetaData({ type: 'TrustPingResponseSent', value: sent })
      } catch (ex) {
        debug(ex)
      }
      return message
    } else if (parsedMessage.type === TRUST_PING_RESPONSE_MESSAGE_TYPE) {
      debug('TrustPingResponse Message Received')
      message.addMetaData({ type: 'TrustPingResponseReceived', value: 'true'})
      return message
    }

    return super.handle(parsedMessage, context)
  }
}
