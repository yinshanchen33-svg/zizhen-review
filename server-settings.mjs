// 不设置模型试用次数或累计额度；只校验部署、输入长度和并发配置。
function integer(env,key,fallback,min=1,max=1000000) {
  const value=env[key]===undefined || env[key]==='' ? fallback : Number(env[key]);
  if(!Number.isInteger(value) || value<min || value>max) throw new Error('invalid_configuration');
  return value;
}
// 平台代理可能带默认端口，比较前统一去掉 :443 / :80 和末尾的点。
export function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/,'').replace(/:(443|80)$/,'');
}
export function serverSettings(env) {
  const production=env.NODE_ENV==='production';
  let origin='';
  const originValue=env.PUBLIC_ORIGIN || (env.RENDER==='true' ? env.RENDER_EXTERNAL_URL : '') || '';
  if(originValue) {
    const u=new URL(originValue);
    if(u.protocol!=='https:' || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw new Error('invalid_origin');
    origin=u.origin;
  }
  // PUBLIC_ORIGIN 可以留空：平台的公网域名通常在应用创建后才分配，若强制要求会陷入
  // “没有域名不能启动、不启动又拿不到域名”的死循环。留空时按请求转发头动态校验同源。
  return {production,origin,autoOrigin:!origin,localDev:env.NODE_ENV==='development',maxInput:integer(env,'MAX_INPUT_CHARS',3000,1,5000),
    concurrency:integer(env,'MAX_CONCURRENT_MODEL_CALLS',2,1,10)};
}
