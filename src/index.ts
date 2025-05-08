import {Context, h, Schema, $} from 'koishi'
import {} from 'koishi-plugin-cron'
import axios from 'axios'

export const name = 'network-integral'

export const inject = ['database', 'cron']

export interface GroupInfo {
  group_id: number
  group_name: string
}

export interface GroupMemberInfo {
  group_id: number
  user_id: number
  nickname: string
  card: string
  sex: string
  age: string
  area: string
  join_time: number
  last_sent_time: number
  level: string
  role: 'owner' | 'admin' | 'member'
  unfriendly: boolean
  title: string
  title_expire_time: number
  card_changeable: boolean
  shut_up_timestamp: number
}


export interface Config {
  probability: number
  scanInterval: string
  autoKick: boolean
  notifyUser: string
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
  // 定时任务设置
  // ========================
  scanInterval: Schema.string().default('0 0 * * *').description('定时检测周期'),
  autoKick: Schema.boolean().default(false).description('自动踢出模式'),
  notifyUser: Schema.string().default('494089941').description('检测完成后通知qq'),

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
      .description(['扣除成功提示',
        '可用占位符：',
        '• %amount% - 扣除积分',
        '• %target% - 扣除对象',
        '• %score% - 操作后积分'].join('\n')),

    transferSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('转赠 %amount% 积分给 %target% 成功')
      .description(['转赠成功提示',
        '可用占位符：',
        '• %amount% - 转赠积分',
        '• %target% - 转赠对象',
        '• %score% - 操作后积分'].join('\n')),

    querySuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default(['当前积分：%score%,排名%rank%', '您现有积分：%score%,排名%rank%'])
      .description(['查询成功提示',
        '可用占位符：',
        '• %rank% - 当前排名',
        '• %score% - 当前积分'].join('\n')),

    rankSuccess: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('第%rank%名 %user% 积分：%score%')
      .description(['排行榜单行格式',
        '可用占位符：',
        '• %rank% - 排名',
        '• %user% - 名称',
        '• %score% - 当前积分'].join('\n')),

    operationFail: Schema.union([
      Schema.string().description("默认模板"),
      Schema.array(Schema.string()).description("随机选择")
    ])
      .default('操作失败')
      .description('通用操作失败提示')
  }).description('消息模版配置')
})

declare module 'koishi' {
  interface Tables {
    blacklist_manager: BlacklistItem
  }
}

export interface BlacklistItem {
  id: number
  aid: number
  userId: string
  userName: string
  createdAt: Date
  operator: string
}

function getRandomMessage(messages: string | string[]): string {
  if (Array.isArray(messages)) {
    return messages[Math.floor(Math.random() * messages.length)]
  }
  return messages
}

export function apply(ctx: Context, config: Config) {

  // MySQL表结构定义
  ctx.model.extend('blacklist_manager', {
    id: {type: 'unsigned', nullable: false},
    aid: {type: 'unsigned', nullable: false},
    userId: {type: 'string', length: 255, nullable: false},
    userName: {type: 'string', length: 255, nullable: false},
    createdAt: {
      type: 'timestamp', nullable: false,initial:new Date(),},
    operator: {type: 'string', length: 255}
  }, {
    primary: 'id',
    autoInc: true,
    unique: [['aid']]
  })


  const blacklistLogger = ctx.logger('blacklist-manager')

  // 用户解析
  async function resolveUser(userId: string): Promise<number> {

    const aids = await ctx.database.get('binding', (row) => $.eq(row.pid, userId), ['aid'])
    if (aids.length > 0) {
      return aids[0].aid
    }
    return 0
  }

  // 消息模板处理函数
  const replacePlaceholders = (template: string, data: Record<string, string>) => {
    return Object.entries(data).reduce(
      (str, [key, value]) => str.replace(new RegExp(`%${key}%`, 'g'), value),
      template
    )
  }

  const parseUser = (text: string) => {
    // 匹配两种格式：
    // 1. @提及格式：<at id="数字ID"
    // 2. 纯数字 QQ 号：整个字符串为数字
    const match = text.match(/<at id="(\d+)"|^(\d+)$/);

    // 优先返回 @提及 的 ID，若不存在则检查纯数字
    return match?.[1] ?? match?.[2] ?? null;
  };

  // 解析是否为随机加分
  function parseUserIdAndName(str) {
    const pattern = /^randomAdd([^$]+)\$(.*)/;
    const match = str.match(pattern);

    if (!match || match[1].length === 0) return null;

    return {
      userId: match[1],
      userName: match[2] || "", // 允许 userName 为空
    };
  }

  const toAtUser = (userid: string, username: string) => `<at id="${userid}">${username}</at>`

  // 中间件处理普通消息
  ctx.middleware(async (session, next) => {
    // 监听群消息
    if (session.subtype !== 'group') return next()
    if (Math.random() > config.probability) return next()
    const { content, uid, userId } = session
    // 机器人消息不触发
    if (ctx.bots[uid]) return
    const userInfo = await session.bot.getUser(session.userId)
    const userName = userInfo?.name || `用户${session.userId.slice(-4)}`
    const message=`randomAdd${userId}\$${userName}`
    return next(message)
    return next()
  })

  ctx.before('send',(session, options)=>{
    if (session.content.startsWith('randomAdd')){
      const {userId,userName} = parseUserIdAndName(session.content)
      try {
        const response = await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          userId: userId,
          name: userName,
          operation: 'randomAdd',
          amount: 1
        })
        if (response.data.code === 0) {
          const template = getRandomMessage(config.messages.addSuccess)
          const message = replacePlaceholders(template, {
            user: `<at id="${session.userId}">${session.username}</at>`,
            score: response.data.data.score
          })
          return message
        } else {
          ctx.logger.warn('积分添加失败:', response.data.message)
        }
      } catch (error) {
        ctx.logger.warn('http异常:', error)
      }
    }
  })

  // 赠送积分指令
  ctx.command('赠送积分 <target> <amount:number>')
    .usage('格式：赠送积分 @用户1 数量')
    .example('赠送积分 @Alice 100')
    .action(async ({session}, target: string, amount) => {
      if (!session) return
      const userId = parseUser(target)
      if (userId === null) {
        return '请输入赠送对象'
      }
      const userInfo = await session.bot.getUser(userId)
      const userName = userInfo?.name || `用户${userId.slice(-4)}`
      try {
        const response = await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          userId: userId,
          operation: 'add',
          name: userName,
          amount: amount
        })

        if (response.data.code === 0) {
          const template = getRandomMessage(
            config.messages.giveSuccess
          )
          return replacePlaceholders(template, {
            target: toAtUser(userId, userName),
            amount: amount.toString(),
            score: response.data.data.score
          })
        } else {
          ctx.logger.warn('积分赠送失败:', response.data.message)
        }
      } catch (error) {
        return config.messages.operationFail
      }
    })

  // 扣除积分指令
  ctx.command('扣除积分 <target> <amount:number>')
    .usage('格式：扣除积分 @用户1 数量')
    .example('扣除积分 @Alice 100')
    .action(async ({session}, target: string, amount) => {
      if (!session) return
      const userId = parseUser(target)
      if (userId === null) {
        return '请输入扣除对象'
      }
      const userInfo = await session.bot.getUser(userId)
      const userName = userInfo?.name || `用户${userId.slice(-4)}`
      try {
        const response = await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          userId: userId,
          operation: 'deduct',
          amount: amount
        })

        if (response.data.code === 0) {
          const template = getRandomMessage(
            config.messages.deductSuccess
          )
          return replacePlaceholders(template, {
            target: `<at id="${userId}">${userName}</at>`,
            amount: amount.toString(),
            score: response.data.data.score
          })
        } else if (response.data.code === 40002) {
          return `<at id="${userId}">${userName}</at> 积分不足`
        } else {
          ctx.logger.warn('积分扣除失败:', response.data.message)
        }

      } catch (error) {
        return config.messages.operationFail
      }
    })

  // 转赠积分指令
  ctx.command('转赠积分 <target1> <target2> <amount:number>')
    .usage('格式：转赠积分 @用户1 @用户2 数量')
    .example('转赠积分 @Alice @Bob 100')
    .action(async ({session}, target1: string, target2: string, amount) => {
      if (!session) return
      const userId1 = parseUser(target1)
      const userId2 = parseUser(target2)
      if (userId1 === null || userId2 === null) {
        return '请输入转赠对象'
      }

      if (!userId1 || !userId2) {
        return '请通过 @提及 指定用户'
      }
      // 校验积分数量
      if (amount <= 0) {
        return '积分数量必须大于 0'
      }
      const userInfo1 = await session.bot.getUser(userId1)
      const userInfo2 = await session.bot.getUser(userId2)
      const userName1 = userInfo1?.name || `用户${userId1.slice(-4)}`
      const userName2 = userInfo2?.name || `用户${userId2.slice(-4)}`

      try {
        const response = await axios.post(`${config.api.baseUrl}/${config.api.endpoints.modify}`, {
          userId: userId1,
          target: userId2,
          name: userName1,
          targetName: userName2,
          operation: 'transfer',
          amount: amount
        })

        if (response.data.code === 0) {
          const template = getRandomMessage(
            config.messages.transferSuccess
          )
          return replacePlaceholders(template, {
            user: `<at id="${userId1}">${userName1}</at>`,
            target: `<at id="${userId2}">${userName2}</at>`,
            amount: amount.toString(),
            score: response.data.data.score
          })
        } else if (response.data.code === 40002) {
          return `<at id="${userId1}">${userName1}</at> 积分不足`
        } else {
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
          params: {userId: session.userId}
        })

        if (response.data.code === 0) {
          const template = getRandomMessage(config.messages.querySuccess)
          return replacePlaceholders(template, {
            user: `<at id="${session.userId}">${session.username}</at>`,
            score: response.data.data.score,
            rank: response.data.data.rank
          })
        } else {
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

        if (response.data.code === 0) {
          const template = getRandomMessage(config.messages.rankSuccess)
          let output = "🏆 积分排行榜："
          const rankList = response.data.data.rank
          for (let index = 0; index < rankList.length; index++) {
            const item = rankList[index]
            output += '\n' + template
              .replace('%rank%', (index + 1).toString())
              .replace('%user%', item.name)
              .replace('%score%', item.score.toString())
          }
          return output
        } else {
          ctx.logger.warn('积分排行查询失败:', response.data.message)
        }

      } catch (error) {
        return config.messages.operationFail
      }
    })


  // 拉黑用户
  ctx.command('拉黑用户 <target:string>')
    .usage('格式：拉黑用户 @用户1/QQ号')
    .example('拉黑用户 @Alice')
    .action(async ({session}, target: string) => {

      if (session === null) return
      const userId = parseUser(target)
      if (userId === null) return '请通过 @提及 指定用户'
      const userInfo = await session!.bot.getUser(userId)
      const userName = userInfo?.name || `用户${userId.slice(-4)}`
      const aid = await resolveUser(userId)
      if (aid === 0) return `用户未绑定`
      await ctx.database.withTransaction(async (t) => {
        // 使用批量更新优化
        await t.set('user', [aid], {authority: 0})

        await t.upsert('blacklist_manager', (row) => [
          {aid: aid, userId: userId, userName: userName, operator: session?.userId || 'system'}], ['aid'])
      })
      return `${toAtUser(userId, userName)}已被全局拉黑`
    })
  // 解除拉黑
  ctx.command('解除拉黑 <target:string>', '解除拉黑')
    .usage('格式：解除拉黑 @用户1/QQ号')
    .example('解除拉黑 123456789')
    .action(async ({session}, target: string) => {
      if (session === null) return
      const userId = parseUser(target)
      if (userId === null) return '请通过 @提及 指定用户'
      const userInfo = await session!.bot.getUser(userId)
      const userName = userInfo?.name || `用户${userId.slice(-4)}`
      const aid = await resolveUser(userId)
      if (aid === 0) return `用户未绑定`
      try {
        await ctx.database.withTransaction(async (t) => {
          await t.set('user', [aid], {authority: 1})
          await t.remove('blacklist_manager', (row) => $.eq(row.aid, aid))
        })
        return `${toAtUser(userId, userName)}已解除拉黑`
      } catch (e) {
        blacklistLogger.info(`${userId}${userName} 拉黑失败`)
      }


    })

  // 查询接口
  ctx.command('查询黑名单 <userId:string>', '查询状态')
    .usage('格式：查询黑名单 QQ号')
    .example('查询黑名单 123456789')
    .action(async ({session}, userId) => {
      const exists = await ctx.database.get('blacklist_manager', {userId: userId})
      return exists ? `用户 ${userId} 在全局黑名单中` : '用户未拉黑'
    })

  // 分页输出
  ctx.command('黑名单列表', '列出黑名单')
    .usage('格式：黑名单列表 -p 页数')
    .example('黑名单列表 -p 1')
    .option('page', '-p <page:number>', {fallback: 1})
    .action(async ({options}) => {
      const pageSize = 10
      const total = await ctx.database.select('blacklist_manager').execute(row => $.count(row.id))
      const page = options?.page || 1
      const list = await ctx.database.select('blacklist_manager').limit(pageSize)
        .offset((page - 1) * pageSize).orderBy('id', 'desc').execute()

      return h('message', [
        h.text(`黑名单记录（第${page}页）:\n`),
        ...list.map(item =>
          h.text(`- @${item.userName} ${item.userId} - \n`)
        ),
        h.text(`共${total}条记录，使用 -p 参数翻页`)
      ])
    })
  // 定时任务
  if (config.autoKick) {
    ctx.cron(config.scanInterval, () => {
      blacklistLogger.info('启动定时黑名单扫描')
      executeScan()
    })
  }

  // 手动触发扫描
  ctx.command('检测群黑名单', '检测bot所在群，若有成员在黑名单则踢出群')
    .usage('格式：检测群黑名单')
    .example('检测群黑名单')
    .action(({session}) => {
      executeScan()
      return '开始检测'
    })

  // 扫描执行器
  async function executeScan() {
    const blacklist = new Set((await ctx.database.select('blacklist_manager').execute()).map(black => black.userId))
    let kickCount=0
    for (const bot of ctx.bots) {
      const guilds: GroupInfo[] = await bot.internal.getGroupList()
      for (const guild of guilds) {
        const memberList: GroupMemberInfo[] = await bot.internal.getGroupMemberList(guild.group_id)
        let userId: number
        let username:string
        for (const groupMemberInfo of memberList) {
          if (groupMemberInfo.user_id === null) {
            continue
          } else {
            userId = groupMemberInfo.user_id
            username = groupMemberInfo.nickname
          }
          if (blacklist.has(`${userId}`)) {
            try {
              await bot.internal.setGroupKick(guild.group_id, userId)
              blacklistLogger.success(`踢出用户 ${username} ${userId} 来自 ${guild.group_name} ${guild.group_id} `)
            } catch (error) {
              blacklistLogger.warn(`踢出用户 ${username} ${userId} 来自 ${guild.group_name} ${guild.group_id}`)
              blacklistLogger.warn(error)
              continue
            }
            await bot.sendPrivateMessage(config.notifyUser, `踢出用户 ${userId} 来自 ${guild.group_id}`)
            kickCount++
          }
        }
      }
    }
    await bot.sendPrivateMessage(config.notifyUser, `检测完成,本次共踢出${kickCount}人`)
  }
  ctx.middleware()

  // 监听入群申请
  ctx.on("guild-member-request", async (session) => {
    const exists = await ctx.database.get('blacklist_manager', {userId: session.userId})
    if (exists){
      await session.bot.handleGuildMemberRequest(
        session.messageId,
        false
      );
    }
  });

  // 监听入群邀请
  ctx.on("guild-request", async (session) => {
    const exists = await ctx.database.get('blacklist_manager', {userId: session.userId})
    if (exists){
      await session.bot.handleGuildRequest(
        session.messageId,
        false
      );
    }
  });

  // 监听群成员减少事件
  ctx.on('guild-member-removed', (session) => {
    // 判断是否为踢人事件（而非成员主动退群）
    if (session===null) return
    if (session.subType === 'kick') {
      const operatorId = session!.operatorId;
      const userId = session!.userId;
      const userInfo = await session!.bot.getUser(userId)
      const userName = userInfo?.name || `用户${userId.slice(-4)}`
      const aid = await resolveUser(userId)
      if (aid === 0) return `用户未绑定`
      await ctx.database.withTransaction(async (t) => {
        await t.set('user', [aid], {authority: 0})
        await t.upsert('blacklist_manager', (row) => [
          {aid: aid, userId: userId, userName: userName, operator: operatorId || 'system'}], ['aid'])
      })
      return `${toAtUser(userId, userName)}已被全局拉黑`
    }
  });
}
