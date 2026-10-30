import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true, args:['--headless=new','--no-sandbox'] })
const p = await b.newContext({ viewport:{width:1440,height:1000}, deviceScaleFactor:1.2 }).then(c=>c.newPage())
const errs=[]; p.on('pageerror',e=>errs.push(e.message))
await p.goto('http://localhost:4173/',{waitUntil:'networkidle'})
await p.evaluate(()=>localStorage.removeItem('pricecheck-edits-v1'))
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(1500)
await p.getByText('Города, бренды, поставщики',{exact:true}).click(); await p.waitForTimeout(1200)
await p.screenshot({path:'a-analytics.png', fullPage:true})
// test city filter -> Астана
await p.getByRole('button',{name:'Астана',exact:true}).click(); await p.waitForTimeout(1000)
await p.screenshot({path:'a-astana.png'})
console.log('errors:', errs.length?errs.join('|'):'none')
await b.close()
