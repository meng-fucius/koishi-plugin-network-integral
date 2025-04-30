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
        '• %score% - 当前积分'
      ].join('\n')),

    giveSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('成功赠送 %amount% 积分给 %target%')
      .description('赠送成功提示'),

    deductSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('已扣除 %target% %amount% 积分')
      .description('扣除成功提示'),

    transferSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('转赠 %amount% 积分给 %target% 成功')
      .description('转赠成功提示'),

    querySuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default(['当前积分：%score%', '您现有积分：%score%'])
      .description('查询成功提示'),

    rankSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('🏆 积分排行榜：\n%rank%')
      .description('排行榜提示'),

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

    try {
      const response = await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
        userId: session.userId,
        groupId: session.guildId,
        operation: 'add',
        amount: 1
      })

      if (response.data.success) {
        const template = getRandomMessage(config.messages.addSuccess)
        const message = replacePlaceholders(template, {
          user: session.username,
          score: response.data.score
        })
        session.send(message)
      }
    } catch (error) {
      ctx.logger.warn('积分添加失败:', error)
    }
  })

  // 赠送积分指令
  ctx.command('赠送积分 <target:string> <amount:number>')
    .action(async ({session}, target, amount) => {
      if (!session) return

      try {
        await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          operator: session.userId,
          target,
          amount,
          operation: 'give'
        })

        const template = getRandomMessage(
          config.messages.giveSuccess
        )
        return replacePlaceholders(template, {
          target,
          amount: amount.toString()
        })
      } catch (error) {
        return config.messages.operationFail
      }
    })

  // 扣除积分指令
  ctx.command('扣除积分 <target:string> <amount:number>')
    .action(async ({session}, target, amount) => {
      if (!session) return

      try {
        await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          operator: session.userId,
          target,
          amount,
          operation: 'deduct'
        })

        const template = getRandomMessage(
          config.messages.deductSuccess
        )
        return replacePlaceholders(template, {
          target,
          amount: amount.toString()
        })
      } catch (error) {
        return config.messages.operationFail
      }
    })

  // 转赠积分指令
  ctx.command('转赠积分 <target:string> <amount:number>')
    .action(async ({session}, target, amount) => {
      if (!session) return

      try {
        await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          operator: session.userId,
          target,
          amount,
          operation: 'transfer'
        })

        const template = getRandomMessage(
          config.messages.transferSuccess
        )
        return replacePlaceholders(template, {
          target,
          amount: amount.toString()
        })
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

        const template = getRandomMessage(config.messages.querySuccess)
        return replacePlaceholders(template, {
          score: response.data.score
        })
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

        const template = getRandomMessage(config.messages.rankSuccess)
        return replacePlaceholders(template, {
          rank: response.data.rank.join('\n')
        })
      } catch (error) {
        return config.messages.operationFail
      }
    })
}
