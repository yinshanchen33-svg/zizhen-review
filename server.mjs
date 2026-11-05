// Node.js 24 单实例评审服务。静态资源白名单，模型仅在服务端调用。
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {publicConfiguration,review} from './model-service.mjs';
import {serverSettings,normalizeHost} from './server-settings.mjs';
import engine from './rules.js';
const files=new Map([
  ['/', ['index.html','text/html; charset=utf-8']], ['/index.html',['index.html','text/html; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']], ['/rules.js',['rules.js','text/javascript; charset=utf-8']],
  ['/report.js',['report.js','text/javascript; charset=utf-8']], ['/app.js',['app.js','text/javascript; charset=utf-8']]
]);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
const json=(res,status,data,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(data));};
async function bodyJSON(req,limit=32768) {
  const chunks=[];let size=0;
  for await(const chunk of req) {size+=chunk.length;if(size>limit) {const e=new Error();e.status=413;throw e;}chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function headerValue(value) {
  if(Array.isArray(value)) value=value[0];
  return typeof value==='string' ? value.split(',')[0].trim() : '';
}
// 平台代理可能改写 Host 或补默认端口；统一取“浏览器实际使用的公网地址”作为同源基准。
function requestTarget(req,settings,port) {
  const host=normalizeHost(headerValue(req.headers['x-forwarded-host']) || req.headers.host);
  if(!host || !/^[a-z0-9.\-:[\]]{1,253}$/.test(host)) return null;
  if(settings.origin) return host===normalizeHost(new URL(settings.origin).host) ? {origin:settings.origin,host} : null;
  // 本机开发只信任回环地址，防止局域网或 DNS rebinding 直接打接口。
  if(settings.localDev) return [`127.0.0.1:${port}`,`localhost:${port}`].includes(host) ? {origin:`http://${host}`,host} : null;
  // 云端未填写 PUBLIC_ORIGIN 时按转发头推导，仍然要求 POST 的 Origin 与站点同源。
  const forwarded=headerValue(req.headers['x-forwarded-proto']).toLowerCase();
  const proto=settings.production ? 'https' : forwarded==='https' ? 'https' : 'http';
  return {origin:`${proto}://${host}`,host};
}
export function createAppServer({env=process.env,fetchImpl=fetch,timeoutMs=20000}={}) {
  const settings=serverSettings(env);
  let active=0;
  const server=http.createServer((req,res)=>{route(req,res).catch(()=>{if(!res.headersSent) json(res,503,{code:'service_unavailable',error:'服务暂时不可用，请稍后再试。'});else res.end();});});
  async function route(req,res) {
    let pathname;
    try {pathname=new URL(req.url,'http://local.invalid').pathname;} catch {return json(res,400,{error:'请求格式错误。'});}
    if(pathname==='/healthz' && req.method==='GET') return json(res,200,{status:'ok'});
    const target=requestTarget(req,settings,server.address()?.port);
    if(!target) return json(res,403,{error:'访问地址不受信任。'});
    const origin=target.origin;
    if(req.method==='POST' && (req.headers.origin!==origin || req.headers['x-review-client']!=='zizhen' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')))
      return json(res,403,{error:'请从本站页面发起请求。'});
    // 评委公开试用，不创建账号、会话或登录 Cookie。旧鉴权端点统一关闭。
    if(['/api/login','/api/logout','/api/session'].includes(pathname)) return json(res,404,{error:'接口不存在。'});
    if(pathname==='/api/config' && req.method==='GET') return json(res,200,{...publicConfiguration(env),access:'public',maxInput:settings.maxInput});
    if(pathname==='/api/analyze') {
      if(req.method!=='POST') return json(res,405,{error:'仅支持 POST。'});
      let body;
      try {body=await bodyJSON(req);} catch(error) {return json(res,error.status || 400,{code:'invalid_input',error:'输入格式不正确或文案过长。'});}
      if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['text','category','useModel'].includes(k)) ||
        typeof body.text!=='string' || Array.from(body.text).length>settings.maxInput || !['ordinary','special','unsure'].includes(body.category) || typeof body.useModel!=='boolean')
        return json(res,400,{code:'invalid_input',error:`单次最多 ${settings.maxInput} 个字符，请检查文案与商品范围。`});
      const preliminary=engine.analyze(body.text,body.category);
      if(['empty','unsupported-language','too-long'].includes(preliminary.status)) return json(res,400,{code:'invalid_input',error:'请输入长度符合限制的中文文案。'});
      const external=preliminary.status==='complete' && body.useModel && publicConfiguration(env).mode==='model-available';
      if(external) {
        if(active>=settings.concurrency) return json(res,429,{code:'busy',error:'已有模型请求处理中，请等待后再试。'});
        active++;
      }
      try {return json(res,200,{...await review(body,{env,fetchImpl,timeoutMs})});}
      finally {if(external) {active--;}}
    }
    if(!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'请求方式不支持。'});
    const file=files.get(pathname);
    if(!file) return json(res,404,{error:'页面不存在。'});
    const content=await readFile(new URL(file[0],import.meta.url));
    res.writeHead(200,{...headers,'Content-Type':file[1]});res.end(req.method==='HEAD'?undefined:content);
  }
  server.requestTimeout=10000;server.headersTimeout=10000;
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  // 本地配置文件被 Git/Docker 忽略；线上只读部署平台注入的环境变量。
  if(process.env.NODE_ENV!=='production' && existsSync('.env.local')) process.loadEnvFile('.env.local');
  try {
    const production=process.env.NODE_ENV==='production';
    // 云端一般只注入 PORT：只要不是本机开发，就监听全部网卡，否则反代连不上。
    const deployed=production || (!!process.env.PORT && process.env.NODE_ENV!=='development');
    const port=Number(process.env.PORT || (deployed ? 8080 : 4173));
    const host=process.env.HOST || (deployed ? '0.0.0.0' : '127.0.0.1');
    if(!Number.isInteger(port) || port<1 || port>65535) throw new Error('invalid_port');
    const server=createAppServer();
    server.on('error',()=>{console.error('服务启动失败，请检查端口及部署配置。');process.exitCode=1;});
    server.listen(port,host,()=>{
      const mode=process.env.PUBLIC_ORIGIN ? '站点地址已固定为 '+normalizeHost(new URL(process.env.PUBLIC_ORIGIN).host)+'。'
        : deployed ? '未配置 PUBLIC_ORIGIN，按平台转发头校验同源。' : '本机模式，仅信任回环地址访问。';
      console.log(`字斟服务已启动：${host}:${port}。${mode}配置与凭据不会写入日志。`);
    });
  } catch(error) {
    console.error('服务未启动：'+(error?.message || 'unknown')+'。请检查 HTTPS 站点地址和数值限制。');
    process.exitCode=1;
  }
}
