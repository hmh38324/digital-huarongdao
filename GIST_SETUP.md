# GitHub Gist 排行榜同步设置指南

## 功能说明
通过集成GitHub Gist API，实现跨设备的排行榜数据同步。不同设备完成游戏后，数据会自动同步到云端，每次查看排行榜时都会拉取最新数据。

## 设置步骤

### 1. 创建GitHub Gist
1. 访问 [GitHub Gist](https://gist.github.com/)
2. 创建一个新的Gist
3. 文件名设置为：`leaderboard.json`
4. 内容设置为：`{}`
5. 选择 "Create secret gist" 或 "Create public gist"
6. 点击 "Create gist"
7. 复制Gist ID（URL中的长字符串，例如：`a1b2c3d4e5f6g7h8i9j0`）

### 2. 创建GitHub Personal Access Token
1. 访问 [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. 点击 "Generate new token" > "Generate new token (classic)"
3. 设置Token名称，例如：`Puzzle Game Leaderboard`
4. 选择权限：勾选 `gist` 权限
5. 点击 "Generate token"
6. 复制生成的Token（只显示一次，请妥善保存）

### 3. 配置游戏
在 `index.html` 文件中找到以下配置部分：
```javascript
this.gistConfig = {
    // 请替换为您的GitHub Gist ID
    gistId: 'YOUR_GIST_ID_HERE',
    // 请替换为您的GitHub Personal Access Token
    token: 'YOUR_GITHUB_TOKEN_HERE'
};
```

将 `YOUR_GIST_ID_HERE` 替换为您的Gist ID
将 `YOUR_GITHUB_TOKEN_HERE` 替换为您的Personal Access Token

### 4. 部署更新
将更新后的代码推送到GitHub Pages即可。

## 功能特性

### 自动同步
- 游戏完成后自动将成绩同步到Gist
- 如果网络失败，会降级到本地存储

### 实时更新
- 每次点击排行榜时自动拉取最新数据
- 显示加载状态，提升用户体验

### 错误处理
- 网络错误时自动降级到本地存储
- 配置未设置时使用本地存储
- 控制台会显示详细的错误信息

## 安全说明
- Personal Access Token具有Gist写入权限，请妥善保管
- 建议使用最小权限原则，只授予必要的权限
- 如果Token泄露，请立即在GitHub中撤销

## 故障排除

### 排行榜显示为空
1. 检查Gist ID是否正确
2. 检查Token是否有gist权限
3. 查看浏览器控制台是否有错误信息

### 数据不同步
1. 检查网络连接
2. 检查Token是否有效
3. 查看控制台错误信息

### 配置未生效
1. 确保已保存文件
2. 清除浏览器缓存
3. 重新部署到GitHub Pages
