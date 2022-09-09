// noinspection ES6PreferShortImport

/**
 * This runs a suite of ./shared tests using an agent configured for remote operations.
 * There is a local agent that only uses @veramo/remove-client and a remote agent that provides the actual
 * functionality.
 *
 * This suite also runs a messaging server to run through some examples of DIDComm using did:fake identifiers.
 * See didWithFakeDidFlow() for more details.
 */
// import 'cross-fetch/polyfill'
import {
  Agent,
  createAgent,
  IAgent,
  IAgentOptions,
  IDataStore,
  IDataStoreORM,
  IDIDManager,
  IKeyManager,
  IMessageHandler,
  IResolver,
  TAgent,
} from '../packages/core'
import { MessageHandler } from '../packages/message-handler'
import { KeyManager } from '../packages/key-manager'
import { AliasDiscoveryProvider, DIDManager } from '../packages/did-manager'
import { DIDResolverPlugin } from '../packages/did-resolver'
import { JwtMessageHandler } from '../packages/did-jwt'
import { CredentialIssuer, ICredentialIssuer, W3cMessageHandler } from '../packages/credential-w3c'
import { CredentialIssuerEIP712, ICredentialIssuerEIP712 } from '../packages/credential-eip712'
import {
  CredentialIssuerLD,
  ICredentialIssuerLD,
  LdDefaultContexts,
  VeramoEcdsaSecp256k1RecoverySignature2020,
  VeramoEd25519Signature2018,
} from '../packages/credential-ld'
import { EthrDIDProvider } from '../packages/did-provider-ethr'
import { WebDIDProvider } from '../packages/did-provider-web'
import { getDidKeyResolver, KeyDIDProvider } from '../packages/did-provider-key'
import { DIDComm, DIDCommHttpTransport, DIDCommMessageHandler, IDIDComm } from '../packages/did-comm'
import {
  ISelectiveDisclosure,
  SdrMessageHandler,
  SelectiveDisclosure,
} from '../packages/selective-disclosure'
import { KeyManagementSystem, SecretBox } from '../packages/kms-local'
import { Web3KeyManagementSystem } from '../packages/kms-web3'
import {
  DataStore,
  DataStoreDiscoveryProvider,
  DataStoreORM,
  DIDStore,
  Entities,
  KeyStore,
  migrations,
  PrivateKeyStore,
} from '../packages/data-store'
import { AgentRestClient } from '../packages/remote-client'
import { AgentRouter, MessagingRouter, RequestWithAgentRouter } from '../packages/remote-server'
import { DIDDiscovery, IDIDDiscovery } from '../packages/did-discovery'
import { BrokenDiscoveryProvider, FakeDidProvider, FakeDidResolver } from '../packages/test-utils'

import { DataSource } from 'typeorm'
import { Resolver } from 'did-resolver'
import { getResolver as ethrDidResolver } from "ethr-did-resolver"
import { getResolver as webDidResolver } from 'web-did-resolver'
// @ts-ignore
import express from 'express'
import { Server } from 'http'
import { contexts as credential_contexts } from '@transmute/credentials-context'
import * as fs from 'fs'
// Shared tests
import verifiableDataJWT from './shared/verifiableDataJWT.js'
import verifiableDataLD from './shared/verifiableDataLD.js'
import verifiableDataEIP712 from './shared/verifiableDataEIP712.js'
import handleSdrMessage from './shared/handleSdrMessage.js'
import resolveDid from './shared/resolveDid.js'
import webDidFlow from './shared/webDidFlow.js'
import documentationExamples from './shared/documentationExamples.js'
import keyManager from './shared/keyManager.js'
import didManager from './shared/didManager.js'
import didCommPacking from './shared/didCommPacking.js'
import didWithFakeDidFlow from './shared/didCommWithFakeDidFlow.js'
import messageHandler from './shared/messageHandler.js'
import didDiscovery from './shared/didDiscovery.js'
import utils from './shared/utils.js'
import credentialStatus from './shared/credentialStatus.js'
import { jest } from '@jest/globals'

jest.setTimeout(30000)

const databaseFile = `./tmp/rest-database-${Math.random().toPrecision(5)}.sqlite`
const infuraProjectId = '3586660d179141e3801c3895de1c2eba'
const secretKey = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'
const port = 3002
const basePath = '/agent'

let dbConnection: Promise<DataSource>
let serverAgent: IAgent
let restServer: Server

const getAgent = (options?: IAgentOptions) =>
  createAgent<
    IDIDManager &
      IKeyManager &
      IDataStore &
      IDataStoreORM &
      IResolver &
      IMessageHandler &
      IDIDComm &
      ICredentialIssuer &
      ICredentialIssuerLD &
      ICredentialIssuerEIP712 &
      ISelectiveDisclosure &
      IDIDDiscovery
  >({
    ...options,
    plugins: [
      new AgentRestClient({
        url: 'http://localhost:' + port + basePath,
        enabledMethods: serverAgent.availableMethods(),
        schema: serverAgent.getSchema(),
      }),
    ],
  })

const setup = async (options?: IAgentOptions): Promise<boolean> => {
  dbConnection = new DataSource({
    name: options?.context?.['dbName'] || 'sqlite-test',
    type: 'sqlite',
    database: databaseFile,
    synchronize: false,
    migrations: migrations,
    migrationsRun: true,
    logging: false,
    entities: Entities,
  }).initialize()

  serverAgent = new Agent({
    ...options,
    plugins: [
      new KeyManager({
        store: new KeyStore(dbConnection),
        kms: {
          local: new KeyManagementSystem(new PrivateKeyStore(dbConnection, new SecretBox(secretKey))),
          web3: new Web3KeyManagementSystem({}),
        },
      }),
      new DIDManager({
        store: new DIDStore(dbConnection),
        defaultProvider: 'did:ethr:rinkeby',
        providers: {
          'did:ethr': new EthrDIDProvider({
            defaultKms: 'local',
            ttl: 60 * 60 * 24 * 30 * 12 + 1,
            networks: [
              {
                name: 'mainnet',
                rpcUrl: 'https://mainnet.infura.io/v3/' + infuraProjectId,
              },
              {
                name: 'rinkeby',
                rpcUrl: 'https://rinkeby.infura.io/v3/' + infuraProjectId,
              },
              {
                chainId: 421611,
                name: 'arbitrum:rinkeby',
                rpcUrl: 'https://arbitrum-rinkeby.infura.io/v3/' + infuraProjectId,
                registry: '0x8f54f62CA28D481c3C30b1914b52ef935C1dF820',
              },
            ],
          }),
          'did:web': new WebDIDProvider({
            defaultKms: 'local',
          }),
          'did:key': new KeyDIDProvider({
            defaultKms: 'local',
          }),
          'did:fake': new FakeDidProvider(),
        },
      }),
      new DIDResolverPlugin({
        resolver: new Resolver({
          ...ethrDidResolver({ infuraProjectId }),
          ...webDidResolver(),
          // key: getUniversalResolver(), // resolve using remote resolver... when uniresolver becomes more stable,
          ...getDidKeyResolver(),
          ...new FakeDidResolver(() => serverAgent as TAgent<IDIDManager>).getDidFakeResolver(),
        }),
      }),
      new DataStore(dbConnection),
      new DataStoreORM(dbConnection),
      new MessageHandler({
        messageHandlers: [
          new DIDCommMessageHandler(),
          new JwtMessageHandler(),
          new W3cMessageHandler(),
          new SdrMessageHandler(),
        ],
      }),
      new DIDComm([new DIDCommHttpTransport()]),
      new CredentialIssuer(),
      new CredentialIssuerEIP712(),
      new CredentialIssuerLD({
        contextMaps: [LdDefaultContexts, credential_contexts as any],
        suites: [new VeramoEcdsaSecp256k1RecoverySignature2020(), new VeramoEd25519Signature2018()],
      }),
      new SelectiveDisclosure(),
      new DIDDiscovery({
        providers: [
          new AliasDiscoveryProvider(),
          new DataStoreDiscoveryProvider(),
          new BrokenDiscoveryProvider(),
        ],
      }),
      ...(options?.plugins || []),
    ],
  })

  const agentRouter = AgentRouter({
    exposedMethods: serverAgent.availableMethods(),
  })

  const requestWithAgent = RequestWithAgentRouter({
    agent: serverAgent,
  })

  return new Promise((resolve) => {
    const app = express()
    app.use(basePath, requestWithAgent, agentRouter)
    app.use(
      '/messaging',
      requestWithAgent,
      MessagingRouter({
        metaData: { type: 'DIDComm', value: 'integration test' },
      }),
    )
    restServer = app.listen(port, () => {
      resolve(true)
    })
  })
}

const tearDown = async (): Promise<boolean> => {
  await new Promise((resolve, reject) => restServer.close(resolve))
  try {
    await (await dbConnection).dropDatabase()
    await (await dbConnection).close()
  } catch (e) {
    // nop
  }
  try {
    fs.unlinkSync(databaseFile)
  } catch (e) {
    //nop
  }
  return true
}

const testContext = { getAgent, setup, tearDown }

describe('REST integration tests', () => {
  verifiableDataJWT(testContext)
  verifiableDataLD(testContext)
  verifiableDataEIP712(testContext)
  handleSdrMessage(testContext)
  resolveDid(testContext)
  webDidFlow(testContext)
  documentationExamples(testContext)
  keyManager(testContext)
  didManager(testContext)
  messageHandler(testContext)
  didCommPacking(testContext)
  didWithFakeDidFlow(testContext)
  didDiscovery(testContext)
  utils(testContext)
  credentialStatus(testContext)
})
