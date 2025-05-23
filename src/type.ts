

// 基础漫画项类型
export interface ComicItem {
  id: string
  title: string
}

// 搜索响应类型
export interface SearchResponse {
  success: boolean
  message: string
  data: {
    results: ComicItem[]
    current_page: number
    has_next_page: boolean
  }
}

// 分类浏览响应类型
export interface CategoryResponse {
  success: boolean
  message: string
  data: {
    results: ComicItem[]
    current_page: number
    has_next_page: boolean
    params_used: {
      time: string
      category: string
      order_by: string
    }
  }
}

// 详情响应类型
export interface DetailResponse {
  success: boolean
  message: string
  data: {
    id: string
    title: string
    tags: string[]
  }
}

export interface FileResponse {
  success: boolean
  message: string
  name: string
  data: string
}
