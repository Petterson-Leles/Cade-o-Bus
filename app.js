import { BaseApp } from '@zeppos/zml/base-app'

App(
  BaseApp({
    globalData: {},
    onCreate() {
      console.log('Cadê o Busão: app criado')
    },
    onDestroy() {
      console.log('Cadê o Busão: app encerrado')
    }
  })
)
