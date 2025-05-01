import {Context, Schema} from 'koishi'
import {resolve} from 'path'
import {} from '@koishijs/plugin-console'
import axios from 'axios'
import {adaptUser} from "@koishijs/plugin-adapter-kook";

export const name = 'network-integral'

export interface Config {
  probability: number
  messages: {
    addSuccess: string | string[]
    giveSuccess: string | string[]
    deductSuccess: string | string[]
    transferSuccess: string | string[]
    querySuccess: string | string[]
    rankSuccess: string | string[]
    operationFail: string | string[]
  }
  api: {
    baseUrl: string
    endpoints: {
      modify: string
      query: string
      rank: string
    }
  }
}

export const Config: Schema<Config> = Schema.object({
  // ========================
  // 基础概率设置
  // ========================
  probability: Schema.number()
    .min(0).max(1).step(0.01)
    .default(0.1)
    .description('每次发言触发加分的概率 (0=不触发，1=100%触发)')
    .role('slider'),

  // ========================
  // API 接口配置
  // ========================
  api: Schema.object({
    baseUrl: Schema.string()
      .required()
      .pattern(/^https?:\/\//)
      .description('后端服务基础地址 (需包含 http:// 或 https://)')
      .default(
        'http://localhost:3000'
      ),

    endpoints: Schema.object({
      modify: Schema.string()
        .default('points/modify')
        .description('积分修改接口路径'),

      query: Schema.string()
        .default('points/query')
        .description('积分查询接口路径'),

      rank: Schema.string()
        .default('points/ranking')
        .description('排行榜接口路径'),
    })
      .description('接口路径配置')
  })
    .description('后端接口配置')
    .role('form'),

  // ========================
  // 消息模板配置
  // ========================
  messages: Schema.object({
    addSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ]).default([
        '@%user% 积分+1，当前：%score%',
        '恭喜 @%user% 获得1积分！当前：%score%'
      ])
      .description([
        '随机加分消息模板 (支持多个候选用 \\n 分隔)',
        '可用占位符：',
        '• %user% - 用户名',
        '• %score% - 操作后积分'
      ].join('\n')),

    giveSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('成功赠送 %amount% 积分给 %target%')
      .description(['赠送成功提示',
        '可用占位符：',
        '• %amount% - 赠送积分',
        '• %target% - 赠送对象',
        '• %score% - 操作后积分'].join('\n')),

    deductSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('已扣除 %target% %amount% 积分')
      .description(['扣除成功提示' ,
        '可用占位符：',
        '• %amount% - 扣除积分',
        '• %target% - 扣除对象',
        '• %score% - 操作后积分'].join('\n')),

    transferSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('转赠 %amount% 积分给 %target% 成功')
      .description(['转赠成功提示' ,
        '可用占位符：',
        '• %amount% - 转赠积分',
        '• %target% - 转赠对象',
        '• %score% - 操作后积分'].join('\n')),

    querySuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default(['当前积分：%score%,排名%rank%', '您现有积分：%score%,排名%rank%'])
      .description(['查询成功提示' ,
        '可用占位符：',
        '• %rank% - 当前排名',
        '• %score% - 当前积分'].join('\n')),

    rankSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('第%rank%名 %user% 积分：%score%')
      .description(['排行榜单行格式' ,
        '可用占位符：' ,
        '• %rank% - 排名' ,
        '• %user% - 名称' ,
        '• %score% - 当前积分'].join('\n')),

    operationFail: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('操作失败')
      .description('通用操作失败提示')
  }).description('消息模版配置')
})

function getRandomMessage(messages: string | string[]): string {
  if (Array.isArray(messages)) {
    return messages[Math.floor(Math.random() * messages.length)]
  }
  return messages
}

export function apply(ctx: Context, config: Config) {
  // 消息模板处理函数
  const replacePlaceholders = (template: string, data: Record<string, string>) => {
    return Object.entries(data).reduce(
      (str, [key, value]) => str.replace(new RegExp(`%${key}%`, 'g'), value),
      template
    )
  }


  // 监听群消息
  ctx.on('message', async (session) => {
    if (session.subtype !== 'group') return
    if (Math.random() > config.probability) return
    const targetUser = await session.bot.getUser(userId)
    const userName = targetUser?.name || `用户${userId.slice(-4)}`
    try {
      const response = await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
        userId: session.userId,
        name: userName,
        operation: 'randomAdd',
        amount: 1
      })

      if (response.data.code===0) {
        const template = getRandomMessage(config.messages.addSuccess)
        const message = replacePlaceholders(template, {
          user: session.username,
          score: response.data.data.score
        })
        session.send(message)
      }else {
        ctx.logger.warn('积分添加失败:', response.data.message)
      }
    } catch (error) {
      ctx.logger.warn('http异常:', error)
    }
  })

  // 赠送积分指令
  ctx.command('赠送积分 <target:user> <amount:number>')
    .action(async ({session}, target, amount) => {
      if (!session) return
      const userId = target.id
      const username = target.name || target.nickname
      try {
        await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          userId: userId,
          operation: 'add',
          name:username,
          amount: amount
        })

        if (response.data.code===0) {
          const template = getRandomMessage(
            config.messages.giveSuccess
          )
          return replacePlaceholders(template, {
            target:username,
            amount: amount.toString(),
            score: response.data.data.score
          })
        }else {
          ctx.logger.warn('积分赠送失败:', response.data.message)
        }
      } catch (error) {
        return config.messages.operationFail
      }
    })

  // 扣除积分指令
  ctx.command('扣除积分 <target:user> <amount:number>')
    .action(async ({session}, target, amount) => {
      if (!session) return
      const userId = target.id
      const username = target.name || target.nickname
      try {
        await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          userId: userId,
          operation: 'deduct',
          amount: amount
        })

        if (response.data.code===0) {
          const template = getRandomMessage(
            config.messages.deductSuccess
          )
          return replacePlaceholders(template, {
            target:username,
            amount: amount.toString(),
            score:response.data.data.score
          })
        }else {
          ctx.logger.warn('积分扣除失败:', response.data.message)
        }

      } catch (error) {
        return config.messages.operationFail
      }
    })

  // 转赠积分指令
  ctx.command('转赠积分 <target1:user> <target2:user> <amount:number>')
    .action(async ({session}, target1,target2, amount) => {
      if (!session) return
      const userId1 = target1.id
      const username1 = target1.name || target1.nickname
      const userId2 = target2.id
      const username2 = target2.name || target2.nickname
      try {
        await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          userId:userId1,
          target:userId2,
          operation: 'transfer',
          amount: amount
        })

        if (response.data.code===0) {
          const template = getRandomMessage(
            config.messages.transferSuccess
          )
          return replacePlaceholders(template, {
            target:username2,
            amount: amount.toString(),
            score: response.data.data.score
          })
        }else {
          ctx.logger.warn('积分转赠失败:', response.data.message)
        }

      } catch (error) {
        return config.messages.operationFail
      }
    })

  // 查询积分指令
  ctx.command('我的积分')
    .action(async ({session}) => {
      if (!session) return

      try {
        const response = await axios.get(`${config.api.baseUrl}/${config.api.endpoints.query}`, {
          params: { userId: session.userId }
        })

        if (response.data.code===0) {
          const template = getRandomMessage(config.messages.querySuccess)
          return replacePlaceholders(template, {
            score: response.data.data.score,
            rank: response.data.data.rank
          })
        }else {
          ctx.logger.warn('积分查询失败:', response.data.message)
        }
      } catch (error) {
        return config.messages.operationFail
      }
    })

  // 积分排行榜指令
  ctx.command('积分排行')
    .action(async ({session}) => {
      if (!session) return

      try {
        const response = await axios.get(`${config.api.baseUrl}/${config.api.endpoints.rank}`)

        if (response.data.code===0) {
          const template = getRandomMessage(config.messages.rankSuccess)
          let output="🏆 积分排行榜："
          ctx.logger.warn(response.data.data)
          const rankList = response.data.data.rank
          for (let index = 0; index < rankList.length; index++) {
            const item = rankList[index]
            output += '\n' + template
              .replace('%rank%', (index + 1).toString())
              .replace('%user%', item.name)
              .replace('%score%', item.score.toString())
          }
          return output
        }else {
          ctx.logger.warn('积分排行查询失败:', response.data.message)
        }

      } catch (error) {
        return config.messages.operationFail
      }
    })
}
