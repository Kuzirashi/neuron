const SUBJECT_PATH = `./models/subjects`

const FallbackSubject = {
  subscribe: (args: any) => {
    console.warn('remote is not supported')
    console.info(JSON.stringify(args))
    return {
      unsubscribe: () => {
        console.info('unsubscribe')
      },
    }
  },
  unsubscribe: () => {
    console.info('unsubscribe')
  },
}
export const SystemScript = window.remote
  ? (window.remote.require(`${SUBJECT_PATH}/system-script`).default as NeuronWalletSubject<{ codeHash: string }>)
  : FallbackSubject

export const DataUpdate = window.remote
  ? (window.remote.require(`${SUBJECT_PATH}/data-update`).default as NeuronWalletSubject<{
      dataType: 'address' | 'transaction' | 'wallet' | 'network'
      actionType: 'create' | 'update' | 'delete'
      walletID?: string
    }>)
  : FallbackSubject

export const NetworkList = window.remote
  ? (window.remote.require(`${SUBJECT_PATH}/networks`).NetworkListSubject as NeuronWalletSubject<{
      currentNetworkList: State.Network[]
    }>)
  : FallbackSubject

export default {
  SystemScript,
  DataUpdate,
  NetworkList,
}
