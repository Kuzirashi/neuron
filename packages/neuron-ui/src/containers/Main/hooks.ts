import { useEffect } from 'react'

import { WalletWizardPath } from 'components/WalletWizard'
import { NeuronWalletActions, StateDispatch, AppActions } from 'states/stateProvider/reducer'
import { actionCreators } from 'states/stateProvider/actionCreators'

import UILayer, { AppMethod, ChainMethod, WalletsMethod, walletsCall } from 'services/UILayer'
import { initWindow, getTransactionList, getTransaction } from 'services/remote'
import {
  SystemScript as SystemScriptSubject,
  DataUpdate as DataUpdateSubject,
  NetworkList as NetworkListSubject,
  CurrentNetworkID as CurrentNetworkIDSubject,
} from 'services/subjects'
import { ckbCore, getTipBlockNumber, getBlockchainInfo } from 'services/chain'
import { Routes, Channel, ConnectionStatus } from 'utils/const'
import {
  wallets as walletsCache,
  networks as networksCache,
  addresses as addressesCache,
  currentNetworkID as currentNetworkIDCache,
  currentWallet as currentWalletCache,
  systemScript as systemScriptCache,
} from 'utils/localCache'
import addressesToBalance from 'utils/addressesToBalance'
import initializeApp from 'utils/initializeApp'

let timer: NodeJS.Timeout
const SYNC_INTERVAL_TIME = 10000

export const useChannelListeners = ({
  walletID,
  chain,
  dispatch,
  history,
  i18n,
}: {
  walletID: string
  chain: State.Chain
  dispatch: StateDispatch
  history: any
  i18n: any
}) =>
  useEffect(() => {
    UILayer.on(Channel.App, (_e: Event, method: AppMethod, args: ChannelResponse<any>) => {
      if (args && args.status) {
        switch (method) {
          case AppMethod.NavTo: {
            history.push(args.result)
            break
          }
          case AppMethod.ToggleAddressBook: {
            dispatch(actionCreators.toggleAddressBook())
            break
          }
          default: {
            break
          }
        }
      }
    })

    UILayer.on(Channel.Chain, (_e: Event, method: ChainMethod, args: ChannelResponse<any>) => {
      if (args && args.status) {
        switch (method) {
          case ChainMethod.Status: {
            dispatch({
              type: NeuronWalletActions.Chain,
              payload: {
                connectionStatus: args.result ? ConnectionStatus.Online : ConnectionStatus.Offline,
              },
            })
            break
          }
          case ChainMethod.TipBlockNumber: {
            dispatch({
              type: NeuronWalletActions.Chain,
              payload: {
                tipBlockNumber: args.result || '0',
              },
            })
            break
          }
          default: {
            break
          }
        }
      }
    })

    UILayer.on(Channel.Wallets, (_e: Event, method: WalletsMethod, args: ChannelResponse<any>) => {
      if (args.status) {
        switch (method) {
          case WalletsMethod.Create:
          case WalletsMethod.ImportMnemonic:
          case WalletsMethod.Update: {
            let template = ''
            if (method === WalletsMethod.Create) {
              template = 'messages.wallet-created-successfully'
            } else if (method === WalletsMethod.Update) {
              template = 'messages.wallet-updated-successfully'
            } else {
              template = 'messages.wallet-imported-successfully'
            }
            const content = i18n.t(template, { name: args.result.name })
            dispatch({
              type: AppActions.AddNotification,
              payload: {
                type: 'success',
                content,
                timestamp: Date.now(),
              },
            })
            history.push(Routes.Overview)
            break
          }
          case WalletsMethod.GetAll: {
            dispatch({
              type: NeuronWalletActions.Settings,
              payload: { wallets: args.result },
            })
            walletsCache.save(args.result)
            break
          }
          case WalletsMethod.GetCurrent: {
            dispatch({
              type: NeuronWalletActions.Wallet,
              payload: args.result,
            })
            currentWalletCache.save(args.result)
            break
          }
          case WalletsMethod.SendCapacity: {
            if (args.result) {
              history.push(Routes.History)
            }
            break
          }
          case WalletsMethod.SendingStatus: {
            dispatch({
              type: NeuronWalletActions.Wallet,
              payload: {
                sending: args.result,
              },
            })
            break
          }
          case WalletsMethod.GetAllAddresses: {
            const addresses = args.result || []
            dispatch({
              type: NeuronWalletActions.Wallet,
              payload: {
                addresses,
                balance: addressesToBalance(addresses),
              },
            })
            addressesCache.save(addresses)
            break
          }
          case WalletsMethod.RequestPassword: {
            dispatch({
              type: AppActions.RequestPassword,
              payload: {
                walletID: args.result.walletID || '',
                actionType: args.result.actionType || '',
              },
            })
            break
          }
          default: {
            break
          }
        }
      } else {
        if (!args.msg) {
          return
        }
        if (method === WalletsMethod.GetCurrent) {
          return
        }
        const { content } = typeof args.msg === 'string' ? { content: args.msg } : args.msg || { content: '' }
        dispatch({
          type: AppActions.AddNotification,
          payload: {
            type: 'alert',
            content,
            timestamp: Date.now(),
          },
        })
      }
    })
  }, [walletID, i18n, chain, dispatch, history])

export const useSyncChainData = ({ chainURL, dispatch }: { chainURL: string; dispatch: StateDispatch }) => {
  useEffect(() => {
    const syncTipNumber = () =>
      getTipBlockNumber()
        .then(tipBlockNumber => {
          dispatch({
            type: AppActions.UpdateTipBlockNumber,
            payload: tipBlockNumber,
          })
        })
        .catch(console.error)

    const syncBlockchainInfo = () => {
      getBlockchainInfo()
        .then(info => {
          if (info) {
            const { chain = '', difficulty = '', epoch = '', alerts = [] } = info
            if (alerts.length) {
              alerts.forEach(a => {
                // TODO: display alerts in Notification
                console.info(a)
              })
            }
            dispatch({
              type: AppActions.UpdateChainInfo,
              payload: {
                chain,
                difficulty,
                epoch,
              },
            })
          }
        })
        .catch(console.error)
    }
    clearInterval(timer)
    if (chainURL) {
      ckbCore.setNode(chainURL)
      syncTipNumber()
      syncBlockchainInfo()
      timer = setInterval(() => {
        syncTipNumber()
        syncBlockchainInfo()
      }, SYNC_INTERVAL_TIME)
    } else {
      ckbCore.setNode('')
    }
    return () => {
      clearInterval(timer)
    }
  }, [chainURL, dispatch])
}

export const useOnCurrentWalletChange = ({
  walletID,
  chain,
  i18n,
  history,
  dispatch,
}: {
  walletID: string
  chain: State.Chain
  i18n: any
  history: any

  dispatch: StateDispatch
}) => {
  const { pageNo, pageSize } = chain.transactions
  useEffect(() => {
    if (walletID) {
      walletsCall.getAllAddresses(walletID)
      getTransactionList({
        walletID,
        keywords: '',
        pageNo,
        pageSize,
      }).then(res => {
        if (res.status) {
          dispatch({
            type: NeuronWalletActions.UpdateTransactionList,
            payload: res.result,
          })
        }
      })
    } else {
      initWindow()
        .then((initializedState: any) => {
          initializeApp({
            initializedState,
            i18n,
            history,
            dispatch,
          })
        })
        .catch((err: Error) => {
          console.error(err)
          history.push(`${Routes.WalletWizard}${WalletWizardPath.Welcome}`)
        })
    }
  }, [walletID, pageNo, pageSize, dispatch, i18n, history])
}

export const useSubscription = ({
  walletID,
  chain,
  dispatch,
}: {
  walletID: string
  chain: State.Chain
  dispatch: StateDispatch
}) => {
  const { pageNo, pageSize, keywords } = chain.transactions
  const { hash: txHash } = chain.transaction
  useEffect(() => {
    const systemScriptSubscription = SystemScriptSubject.subscribe(({ codeHash = '' }: { codeHash: string }) => {
      systemScriptCache.save({ codeHash })
      dispatch({
        type: NeuronWalletActions.UpdateCodeHash,
        payload: codeHash,
      })
    })
    const dataUpdateSubscription = DataUpdateSubject.subscribe(({ dataType, walletID: walletIDOfMessage }: any) => {
      if (walletIDOfMessage && walletIDOfMessage !== walletID) {
        return
      }
      switch (dataType) {
        case 'address': {
          walletsCall.getAllAddresses(walletID)
          break
        }
        case 'transaction': {
          getTransactionList({
            walletID,
            keywords,
            pageNo,
            pageSize,
          }).then(res => {
            if (res.status) {
              dispatch({ type: NeuronWalletActions.UpdateTransactionList, payload: res.result })
            } else {
              // TODO: notification
            }
          })
          getTransaction({ walletID, hash: txHash })
          break
        }
        case 'wallet': {
          walletsCall.getAll()
          walletsCall.getCurrent()
          break
        }
        default: {
          break
        }
      }
    })
    const networkListSubscription = NetworkListSubject.subscribe(({ currentNetworkList = [] }) => {
      dispatch({
        type: NeuronWalletActions.UpdateNetworkList,
        payload: currentNetworkList,
      })
      networksCache.save(currentNetworkList)
    })
    const currentNetworkIDSubscription = CurrentNetworkIDSubject.subscribe(({ currentNetworkID = '' }) => {
      dispatch({
        type: NeuronWalletActions.UpdateCurrentNetworkID,
        payload: currentNetworkID,
      })
      currentNetworkIDCache.save(currentNetworkID)
    })
    return () => {
      systemScriptSubscription.unsubscribe()
      dataUpdateSubscription.unsubscribe()
      networkListSubscription.unsubscribe()
      currentNetworkIDSubscription.unsubscribe()
    }
  }, [walletID, pageNo, pageSize, keywords, txHash, dispatch])
}

export default {
  useChannelListeners,
  useSyncChainData,
  useOnCurrentWalletChange,
  useSubscription,
}
