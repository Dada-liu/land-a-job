/**
 * 本地演示表单页（P4-6 的降级底座，也是 E2E 的靶子）。
 *
 * 为什么内置在服务里而不是挂在公网：投递助手的风险在于「对真实站点做了什么」，
 * 所以先用一个和真实招聘表单结构相似（label/required/select/file/checkbox 齐全）
 * 的本地页面把流程跑通，再拿去打真实官网。没有这一步，自动化测试只能靠手工。
 *
 * `?captcha=1` 会渲染一个验证组件，用于验证「检测到就中止」而不是硬闯。
 */
export function demoFormHtml(options: { captcha?: boolean; title?: string } = {}): string {
  const title = options.title ?? '后端工程师（演示岗）'
  const captcha = options.captcha
    ? `<div class="field">
        <label for="captcha">验证码</label>
        <div id="captcha-box" class="captcha">请输入验证码（人机验证）</div>
        <input id="captcha" name="captcha" type="text" placeholder="请输入验证码" required />
      </div>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${title} · 演示投递表单</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f6f6f4; font: 14px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1c1c1a; }
  main { max-width: 640px; margin: 40px auto; background: #fff; border: 1px solid #e5e5e0; border-radius: 12px; padding: 32px 36px; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  p.sub { margin: 0 0 22px; color: #7a7a72; font-size: 12px; }
  .field { margin-bottom: 14px; }
  label { display: block; font-size: 12px; color: #55554f; margin-bottom: 4px; }
  input[type="text"], input[type="email"], input[type="tel"], select, textarea {
    width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d6d6d0; border-radius: 6px;
    font: inherit; background: #fff; color: inherit;
  }
  textarea { min-height: 84px; resize: vertical; }
  .row { display: flex; gap: 12px; }
  .row .field { flex: 1; }
  .inline { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #55554f; }
  button { margin-top: 8px; padding: 9px 18px; border: 0; border-radius: 6px; background: #1c1c1a; color: #fff; font: inherit; cursor: pointer; }
  .captcha { padding: 14px; border: 1px dashed #d6d6d0; border-radius: 6px; background: #fafaf8; color: #8a8a82; font-size: 12px; margin-bottom: 6px; }
  #done { display: none; }
  #done .ok { padding: 18px; border-radius: 8px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p class="sub">这是本机演示表单，结构与真实招聘官网一致：姓名 / 邮箱 / 手机 / 城市 / 岗位 / 自我介绍 / 简历附件 / 条款。</p>

  <form id="apply-form">
    <div class="row">
      <div class="field">
        <label for="fullname">姓名</label>
        <input id="fullname" name="fullname" type="text" placeholder="请输入真实姓名" required />
      </div>
      <div class="field">
        <label for="email">邮箱</label>
        <input id="email" name="email" type="email" placeholder="you@example.com" required />
      </div>
    </div>

    <div class="row">
      <div class="field">
        <label for="phone">手机号</label>
        <input id="phone" name="phone" type="tel" placeholder="11 位手机号" />
      </div>
      <div class="field">
        <label for="city">期望城市</label>
        <select id="city" name="city">
          <option value="">请选择</option>
          <option value="beijing">北京</option>
          <option value="shanghai">上海</option>
          <option value="hangzhou">杭州</option>
        </select>
      </div>
    </div>

    <div class="field">
      <label for="position">应聘岗位</label>
      <input id="position" name="position" type="text" value="${title}" />
    </div>

    <div class="field">
      <label for="intro">自我介绍</label>
      <textarea id="intro" name="intro" placeholder="用一段话说明为什么匹配这个岗位"></textarea>
    </div>

    <div class="field">
      <label for="resume-file">简历附件</label>
      <input id="resume-file" name="resumeFile" type="file" accept=".pdf,.doc,.docx" />
    </div>

    ${captcha}

    <div class="field">
      <label class="inline">
        <input id="agree" name="agree" type="checkbox" required />
        我已阅读并同意招聘隐私政策
      </label>
    </div>

    <button type="submit">提交申请</button>
  </form>

  <div id="done">
    <div class="ok">申请已提交成功（演示）。真实站点这里会显示投递编号或跳转到确认页。</div>
  </div>
</main>
<script>
  var form = document.getElementById('apply-form');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    // 模拟真实站点的前端校验：必填没填就提示，不提交
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    window.__landSubmitted = true;
    document.getElementById('apply-form').style.display = 'none';
    document.getElementById('done').style.display = 'block';
  });
</script>
</body>
</html>`
}
