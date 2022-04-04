import MongoInterface from "./mongo-interface";
import web3utils from 'web3-utils'

import crypto from 'crypto'

import {bufferToHex, toBuffer, hashPersonalMessage, fromRpcSig, ecrecover, pubToAddress} from 'ethereumjs-util'



const NODE_ENV = process.env.NODE_ENV

export default class AuthTools {

    static getEnvironmentName() : string{
      let envName = NODE_ENV ? NODE_ENV : 'unknown'

      return envName
    }

    static async initializeDatabase(config: any ) : Promise<MongoInterface> {
 
      let mongoInterface = new MongoInterface()

      if(!config) config = {}

      let dbName = config.dbName ? config.dbName :  "degenauth".concat('_').concat(AuthTools.getEnvironmentName())
 
      await mongoInterface.init(dbName, config)

      return mongoInterface

    }

    static generateServiceNameChallengePhrase(unixTime:string, serviceName:string, publicAddress: string){
        
      
      publicAddress = web3utils.toChecksumAddress(publicAddress)

      const accessChallenge = `Signing in to ${serviceName} as ${publicAddress.toString()} at ${unixTime.toString()}`

      return accessChallenge
    }
    
    static async upsertNewChallengeForAccount(mongoInterface:MongoInterface, publicAddress:string, serviceName: string, challengeGenerator?: Function )   {

      const unixTime = Date.now().toString()
      
      publicAddress = web3utils.toChecksumAddress(publicAddress)
  
      let challenge;

      if(challengeGenerator){
        challenge = challengeGenerator( unixTime, serviceName, publicAddress )
      }else{
        challenge = AuthTools.generateServiceNameChallengePhrase(  unixTime, serviceName, publicAddress)
      }

     
      
      let upsert = await mongoInterface.ChallengeTokenModel.findOneAndUpdate(
        { publicAddress: publicAddress },
        { challenge: challenge, createdAt: unixTime },
        {new:true, upsert:true }
      )
     
      
      return challenge 
    }



    static async findActiveChallengeForAccount(mongoInterface:MongoInterface, publicAddress: string) {
      const ONE_DAY = 86400 * 1000

      publicAddress = web3utils.toChecksumAddress(publicAddress)
  
      const existingChallengeToken = await mongoInterface.ChallengeTokenModel.findOne({
        publicAddress: publicAddress,
        createdAt: { $gt: Date.now() - ONE_DAY },
      })
  
      return existingChallengeToken
    }

    static generateNewAuthenticationToken() {
      return crypto.randomBytes(16).toString('hex')
    }

    static async findActiveAuthenticationTokenForAccount(mongoInterface:MongoInterface, publicAddress: string) {
      const ONE_DAY = 86400 * 1000
  
      publicAddress = web3utils.toChecksumAddress(publicAddress)
  
      const existingAuthToken = await mongoInterface.AuthenticationTokenModel.findOne({
        publicAddress: publicAddress,
        createdAt: { $gt: Date.now() - ONE_DAY },
      })
  
      return existingAuthToken
    }

    static async upsertNewAuthenticationTokenForAccount(mongoInterface:MongoInterface, publicAddress: string) {
      const unixTime = Date.now().toString()
  
      const newToken = AuthTools.generateNewAuthenticationToken()
  
      publicAddress = web3utils.toChecksumAddress(publicAddress)
  
       let upsert = await mongoInterface.AuthenticationTokenModel.findOneAndUpdate(
          { publicAddress: publicAddress },
          { token: newToken, createdAt: unixTime },
          {new:true, upsert:true }
        )
      
  
      return newToken
    }




    static async validateAuthenticationTokenForAccount(
      mongoInterface:MongoInterface,
      publicAddress: string,
      authToken: string
    ) {
      //always validate if in dev mode
      if (AuthTools.getEnvironmentName() == 'development') {
        return true
      }
  
      const ONE_DAY = 86400 * 1000
  
      publicAddress = web3utils.toChecksumAddress(publicAddress)
  
      const existingAuthToken = await mongoInterface.AuthenticationTokenModel.findOne({
        publicAddress: publicAddress,
        token: authToken,
        createdAt: { $gt: Date.now() - ONE_DAY },
      })
  
      return existingAuthToken
    }
    

    /*
    This method takes a public address and the users signature of the challenge which proves that they know the private key for the account without revealing the private key.
    If the signature is valid, then an authentication token is stored in the database and returned by this method so that it can be given to the user and stored on their client side as their session token.
    Then, anyone with that session token can reasonably be trusted to be fully in control of the web3 account for that public address since they were able to personal sign. 
    */
    static async generateAuthenticatedSession(mongoInterface:MongoInterface, publicAddress:string, signature:string, challenge?:string){
      if(!challenge){
        let challengeRecord = await AuthTools.findActiveChallengeForAccount(mongoInterface,publicAddress)
          
        if(challengeRecord){
        challenge = challengeRecord.challenge
        }
      }

      if(!challenge){
        return {success:false, error:'no active challenge found for user'} 
      }

      let validation = AuthTools.validatePersonalSignature(publicAddress,signature,challenge)

      if(!validation){
        return {success:false, error:'signature validation failed'} 
      }

      let authToken = await AuthTools.upsertNewAuthenticationTokenForAccount(mongoInterface,publicAddress)

      return {success:true, authToken: authToken} 

    }

    static validatePersonalSignature(
      fromAddress: string,
      signature: string,
      challenge: string,
      signedAt?: number
    ) {

      if(!signedAt) signedAt = Date.now()
      //let challenge = 'Signing for Etherpunks at '.concat(signedAt)
  
      let recoveredAddress = AuthTools.ethJsUtilecRecover(challenge, signature)
  
      if (!recoveredAddress) {
        console.log('mismatch address')
        return false
      }
  
      recoveredAddress = web3utils.toChecksumAddress(recoveredAddress)
  
      if (recoveredAddress != web3utils.toChecksumAddress(fromAddress)) {
        console.log('mismatch address')
        return false
      }
  
      const ONE_DAY = 1000 * 60 * 60 * 24
  
      if (signedAt < Date.now() - ONE_DAY) {
        return false
      }
  
      return true
    }
  
    static ethJsUtilecRecover(msg: string, signature: string) {
         
      try{
        const res = fromRpcSig(signature)
  
        const msgHash = hashPersonalMessage(Buffer.from(msg))
  
        const pubKey = ecrecover(
          toBuffer(msgHash),
          res.v,
          res.r,
          res.s
        )
        const addrBuf = pubToAddress(pubKey)
        const recoveredSignatureSigner = bufferToHex(addrBuf)
        console.log('rec:', recoveredSignatureSigner)
  
        return recoveredSignatureSigner
  
      }catch(e){
        console.error(e)
  
      }
  
      return null 
    }
  


}

  