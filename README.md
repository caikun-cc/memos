# Memos - 个人备忘录

一个简洁的 Markdown 备忘录应用。

## 功能特性

- **Markdown 支持** - 支持标题、列表、代码块、表格等
- **标签管理** - 为备忘录添加标签，快速分类筛选
- **日历视图** - 可视化查看备忘录时间分布
- **搜索功能** - 快速检索备忘录内容
- **置顶功能** - 重要备忘录置顶显示
- **JWT 认证** - 密码登录，Token 自动续期

## 快速开始

```bash
npm install
npm start
```

访问 [http://localhost:8022](http://localhost:8022)，首次使用需在 `config.json` 设置密码。

## 配置说明

配置文件 `config.json`：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| password | 登录密码 | - |
| jwtSecret | JWT 密钥 | 自动生成 |
| tokenExpiresIn | Token 有效期 | 7d |

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript
- **存储**: JSON 文件

## 许可证

MIT
