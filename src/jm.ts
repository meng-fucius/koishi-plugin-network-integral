import { Context, Schema, Session, h } from 'koishi'
import axios, { AxiosError } from 'axios'
import { SearchResponse,CategoryResponse,DetailResponse,FileResponse } from './type'

// 插件配置
export interface JMConfig {
  jm:{baseUrl:string},
}

export const JMConfig: Schema<JMConfig> = Schema.object({
  jm: Schema.object({
    baseUrl: Schema.string()
      .required()
      .pattern(/^https?:\/\//)
      .description('jm服务地址 (需包含 http:// 或 https://)')
      .default(
        'http://localhost:3000'
      ),
  })
    .description('jm配置')
    .role('form'),
})

// 分类参数映射
const CATEGORY_MAP = {
  '同人': 'doujin',
  '单行本': 'single',
  '短篇': 'short',
  '其他': 'another',
  '汉化': 'hanman',
  '美漫': 'meiman',
  '同人志': 'doujin_cosplay',
  'COSPLAY': 'cosplay',
  '3D': '3d',
  '英文': 'english_site',
  '全部': 'all'
} as const

// 排序参数映射
const ORDER_MAP = {
  '最新': 'latest',
  '浏览': 'view',
  '图片数': 'picture',
  '喜欢': 'like',
  '月榜': 'month_rank',
  '周榜': 'week_rank',
  '日榜': 'day_rank'
} as const

// 类型辅助
type CategoryKey = keyof typeof CATEGORY_MAP
type OrderKey = keyof typeof ORDER_MAP

export const name = 'jm-comic'
export const inject = ['http']

// 主插件函数
export function jmComic(ctx: Context, config: JMConfig) {
  const BASE_URL = config.jm.baseUrl

  // 错误处理函数
  function handleError(error: unknown): string {
    // Axios 网络错误处理
    if (ctx.http.isError(error)) {
      const status = error.response?.status
      const data = error.response?.data

      // 优先处理特定状态码
      switch (status) {
        case 404:
          return `❌ 文件未找到，请检查资源ID是否正确`
        case 403:
          return `❌ 访问被拒绝，请检查权限设置`
        case 500:
          return `❌ 后端服务异常，请联系管理员`
      }

      // 处理结构化错误信息
      if (typeof data === 'object' && data !== null) {
        const message =
          'message' in data ? data.message :  // 优先使用后端消息
            'error' in data ? data.error :      // 兼容其他错误格式
              status ? `HTTP ${status} 错误` : '未知网络错误'

        // 记录完整错误日志
        ctx.logger('jm').error(`网络请求失败:
URL: ${error.response?.url}
状态码: ${status || '无响应'}
错误信息: ${JSON.stringify(data)}`)

        return `❌ 请求失败：${message}`
      }

      // 非结构化错误处理
      ctx.logger('jm').error('非结构化错误:', error.stack)
      return `❌ 网络通信异常（状态码：${status || '未知'}）`
    }

    // 系统级错误处理
    if (error instanceof Error) {
      ctx.logger('jm').error('系统运行时错误:', error.stack)
      return `❌ 系统错误：${error.message}`
    }

    // 未知错误类型
    ctx.logger('jm').error('未分类错误:', error)
    return '❌ 发生未知错误，请联系管理员'
  }

  function sanitizeFilename(name: string) {
    return name
      .replace(/[\\/:*?"<>|]/g, '_') // 替换非法字符
      .slice(0, 100)                  // 限制文件名长度
      .trim()
  }

  function safeConvertPathToUrl(path: string): { url: string; filename: string } {
    try {
      const prefix = '/app/JMComic-Api/pdf/'

      // 验证路径格式
      if (!path.startsWith(prefix)) {
        throw new Error(`路径格式无效，必须以 ${prefix} 开头`)
      }

      // 提取原始文件名
      const rawFilename = path.slice(prefix.length)

      // 生成编码后的文件名
      const encodedFilename = encodeURIComponent(rawFilename)
      return {
        url: `http://jm.chomoe.life/${encodedFilename}`,
        filename: sanitizeFilename(rawFilename) // 添加文件名消毒处理
      }
    } catch (e) {
      ctx.logger.error('路径转换失败:', e)
      return { url: '', filename: '' }
    }
  }

  // 搜索命令
  ctx.command('jm.search <query:text>')
    .alias('jm搜索')
    .option('page', '-p <page:number> 页码', { fallback: 1 })
    .action(async ({ session, options }, query) => {
      if (!query) return '请输入搜索关键词'

      try {
        const response = await ctx.http.get<SearchResponse>(`${BASE_URL}/search`, {
          params: { query, page: options!.page }
        })

        if (!response.success) return response.message

        return [
          `📚 第 ${response.data.current_page} 页搜索结果：`,
          ...response.data.results.map(item => `🆔 ${item.id}｜📖 ${item.title}`),
          `➡️ 是否有下一页：${response.data.has_next_page ? '✅ 是' : '❌ 否'}`
        ].join('\n')
      } catch (e) {
        return handleError(e)
      }
    })

  // 下载命令
  ctx.command('jm.download <id:string>')
    .alias('jm下载')
    .option('encrypt', '-e [encrypt:boolean] 启用PDF加密（默认开启）', { fallback: true })
    .option('titleType', '-t <type:number> 文件名类型 (0-数字,1-标题,2-综合)', { fallback: 2 })
    .option('online','-o [online:boolean] 在线观看', {fallback:false})
    .action(async ({ session, options }, id) => {
      if (!/^\d+$/.test(id)) return '❌ 无效的漫画ID'

      try {
        const params = new URLSearchParams({
          passwd: String(options!.encrypt),
          Titletype: String(options!.titleType),
          // pdf: String(options!.direct)
        })

        const pathUrl = `${BASE_URL}/get_pdf_path/${id}?${params}`
        const response = await ctx.http.get<FileResponse>(pathUrl)
        if (!response.success) {
          return `❌ 下载失败：${response.message}`
        }
        // 处理docker路径 替换为宿主机绝对路径
        const {url,filename} = safeConvertPathToUrl(response.data)
        if (url===""){
          return h.text(`❌ 地址转换失败`)
        }
        // 在线观看
        if (options?.online){
          return h.text(`在线观看地址：${url}`)
        }else {
          const filePath =session!.bot.internal.downloadFile(url)
          if (filePath===""){
            return `❌ 下载失败：${response.message}`
          }
          session!.bot.internal.uploadGroupFile(session?.guild,filePath,filename)
        }
        // if (options?.direct) {
        //   const dUrl = `${BASE_URL}/get_pdf/${id}?${params}`
        //   const data = await ctx.http.get(dUrl, {
        //     responseType: 'arraybuffer',
        //     headers: { Accept: 'application/pdf' },
        //   })
        //   return h.file(data, 'application/pdf',{
        //     filename: `${id}.pdf`,
        //   })
        // }

        // const response = await ctx.http.get<FileResponse>(url)
        // if (!response.success) {
        //   return `❌ 下载失败：${response.message}`
        // }
        // return h.file(Buffer.from(response.data, 'base64'),'application/pdf', {
        //   filename: sanitizeFilename(response.name),
        // })
      } catch (e) {
        return handleError(e)
      }
    })

  // 详情命令
  ctx.command('jm.detail <id:string>')
    .alias('jm详情')
    .action(async ({ session }, id) => {
      if (!/^\d+$/.test(id)) return '❌ 无效的漫画ID'

      try {
        const response = await ctx.http.get<DetailResponse>(`${BASE_URL}/album/${id}`)
        if (!response.success) return response.message

        return [
          `📖 标题：${response.data.title}`,
          `🏷️ 标签：${response.data.tags.join(' | ')}`,
          `🆔 车牌号：${response.data.id}`
        ].join('\n')
      } catch (e) {
        return handleError(e)
      }
    })

  // 分类浏览命令
  ctx.command('jm.category')
    .alias('jm分类')
    .option('category', `-c <category:string> 分类选项：${Object.keys(CATEGORY_MAP).join('/')}`, {
      fallback: 'all'
    })
    .option('order', `-o <order:string> 排序方式：${Object.keys(ORDER_MAP).join('/')}`, {
      fallback: 'latest'
    })
    .option('time', '-T <time:string> 时间范围 (today/week/month/all)',{fallback:'all'})
    .option('page', '-p <page:number> 页码', { fallback: 1 })
    .action(async ({ session, options }) => {
      try {
        const params = {
          category: CATEGORY_MAP[options!.category as CategoryKey],
          order_by: ORDER_MAP[options!.order as OrderKey] ,
          time: options!.time?.replace(/^(本周|本月)$/, ''),
          page: options!.page
        }

        const response= await ctx.http.get<CategoryResponse>(`${BASE_URL}/categories`, { params })
        if (!response.success) return response.message

        return [
          `🗂️ 当前分类：${options?.category}`,
          `🔢 排序方式：${options?.order}`,
          `⏳ 时间范围：${options?.time?.replace(/^(本周|本月)$/, '')}`,
          `📖 第 ${response.data.current_page} 页结果：`,
          ...response.data.results.map(item => `🆔 ${item.id}｜📖 ${item.title}`),
          `➡️ 是否有下一页：${response.data.has_next_page ? '✅ 是' : '❌ 否'}`
        ].join('\n')
      } catch (e) {
        return handleError(e)
      }
    })
}

export default jmComic
