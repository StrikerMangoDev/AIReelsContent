import test from 'node:test'
import assert from 'node:assert/strict'
import { feedImage, enrichImages } from '../ingestion/images.js'
import { selectHotArticles } from '../services/news.js'

test('RSS images support media arrays, content images and safe relative URLs', () => {
  assert.equal(feedImage({ media: [{ $: { url: 'https://cdn.example/cover.jpg' } }] }, 'https://publisher.example/news'), 'https://cdn.example/cover.jpg')
  assert.equal(feedImage({ 'content:encoded': '<p>Story</p><img src="/cover.jpg">' }, 'https://publisher.example/news'), 'https://publisher.example/cover.jpg')
  assert.equal(feedImage({ content: '<img src="http://localhost/private">' }, 'https://publisher.example/news'), null)
})
test('research records do not consume the publisher image repair limit', async () => {
  const articles = [...Array.from({length:100},()=>({sourceId:'research'})), {sourceId:'publisher',url:'https://untrusted.example/story'}]
  const result = await enrichImages(articles,[{id:'research',tier:'research'},{id:'publisher',tier:'reporting',domains:['publisher.example']}],{updateImage(){throw new Error('No image should be written')}},1)
  assert.equal(result.attempted,1)
  assert.equal(result.updated,0)
})
test('hot topics prioritize fresh announcements without research floods or duplicate titles', () => {
  const now=Date.now()
  const article={id:'one',title:'Company launches a new device',sourceId:'publisher',sourceTier:'primary',publishedAt:new Date(now).toISOString(),regions:['India'],category:'Hardware',summary:'A launch',excerpt:'Private evidence'}
  const selected=selectHotArticles([article,{...article,id:'duplicate'},{...article,id:'research',title:'Researchers announce a paper',sourceTier:'research'},{...article,id:'old',title:'Old release',publishedAt:new Date(now-100*3600000).toISOString()}],{},now)
  assert.equal(selected.length,1)
  assert.equal(selected[0].id,'one')
  assert.equal('excerpt' in selected[0],false)
  assert.equal(selectHotArticles([article],{region:'China'},now).length,0)
})
