const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256

const deployAPM = require('./apm')

const globalArtifacts = this.artifacts // Not injected unless called directly via truffle
const globalWeb3 = this.web3 // Not injected unless called directly via truffle
const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')

const defaultOwner = process.env.OWNER

module.exports = async (
  truffleExecCallback,
  {
    artifacts = globalArtifacts,
    web3 = globalWeb3,
    owner = defaultOwner,
    verbose = true,
  } = {}
) => {
  const log = (...args) => {
    if (verbose) {
      console.log(...args)
    }
  }

  const APMRegistry = artifacts.require('APMRegistry')
  const APMRegistryFactory = artifacts.require('APMRegistryFactory')  
  const ENSSubdomainRegistrar = artifacts.require('ENSSubdomainRegistrar')
  const Kernel = artifacts.require('Kernel')
  const ACL = artifacts.require('ACL')

  const accounts = await getAccounts(web3)
  if (!owner) {
    owner = accounts[0]
    log(
      "OWNER env variable not found, setting APM owner to the provider's first account"
    )
  }
  log('Owner:', owner)
  
  const tldName = 'aragonpm.eth'
  const labelName = 'open'
  const tldHash = namehash(tldName)
  const labelHash = '0x' + keccak256(labelName)

  // retrieving from `aragonpm.eth`
  const apm_addr = '0x735c188ae020ef71a63e39602d57f9d1e4d3b82f'
  const apm = await APMRegistry.at(apm_addr)
  const apmFactory = await APMRegistryFactory.at('0x6c29CaCcBf8bEeFc51337C8C967A32567c9A105A')
  const registrar = await apm.registrar()
  const apmENSSubdomainRegistrar = await ENSSubdomainRegistrar.at(registrar)
  const create_name_role = await apmENSSubdomainRegistrar.CREATE_NAME_ROLE()

  log('Managing permissions...')
  const kernel = await Kernel.at(await apm.kernel())
  const acl = await ACL.at(await kernel.acl())

  log(`Create permission for root account on create_name_role`)
  await acl.createPermission(owner, registrar, create_name_role, owner, {
    from: owner,
  })
  log('=========')

  log(`TLD: ${tldName} (${tldHash})`)
  log(`Label: ${labelName} (${labelHash})`)
  log('=========')

  log(`Assigning ENS name (${labelName}.${tldName}) to factory...`)
  try {
    await apmENSSubdomainRegistrar.createName(labelHash, apmFactory.address, {
      from: owner,
    })
  } catch (err) {
    console.error(
      `Error: could not set the owner of '${labelName}.${tldName}' on the given ENS instance. Make sure you have ownership rights over the subdomain.`
    )
    throw err
  }

  log('Deploying Open APM...')
  const receipt = await apmFactory.newAPM(tldHash, labelHash, owner)

  log('=========')
  const openAPMAddr = receipt.logs.filter(l => l.event == 'DeployAPM')[0].args.apm
  log('# Open APM:')
  log('Address:', openAPMAddr)
  log('Transaction hash:', receipt.tx)
  log('=========')

  log(`Grant permission to any account to create repos in open.aragonpm.eth`)
  await acl.grantPermission(await acl.ANY_ENTITY(), apm_addr, apm.CREATE_REPO_ROLE())  
  log('=========')
  
  if (typeof truffleExecCallback === 'function') {
    // Called directly via `truffle exec`
    truffleExecCallback()
  } else {
    return {
      apmFactory,
      apm: APMRegistry.at(openAPMAddr),
    }
  }
}

