import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Select, Switch } from 'antd'
import { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { GitSubject } from '@projectos/contracts'
import { ErrorState, LoadingBlock } from '@projectos/ui'
import { DialogShell, OverlayHeader } from '../next-ui/overlay/overlay-shell'
import { errorMessage } from '../lib/errors'
import { useResolvedTheme } from '../stores/ui'
import '../lib/monaco'
import './code-review.css'

const language=(path:string)=>/\.(tsx?|jsx?|[cm]js)$/.test(path)?(/\.tsx?$/.test(path)?'typescript':'javascript'):/\.json$/.test(path)?'json':/\.css$/.test(path)?'css':/\.py$/.test(path)?'python':/\.md$/.test(path)?'markdown':'plaintext'
export function CodeReviewDialog({subject,resolutionId,onClose,onSave}:{subject:GitSubject;resolutionId?:string;onClose:()=>void;onSave?:(path:string,content:string,fingerprint:string)=>Promise<void>}) {
  const query=useQuery({queryKey:['git-code-changes',subject,resolutionId],queryFn:()=>window.projectos.gitDelivery.changes({subject,resolutionId}),refetchOnWindowFocus:false,staleTime:0})
  const theme=useResolvedTheme(),diff=useRef<editor.IStandaloneDiffEditor|null>(null)
  const [selected,setSelected]=useState<string|null>(null),[full,setFull]=useState(true),[wrap,setWrap]=useState(true),[sideBySide,setSideBySide]=useState(()=>window.innerWidth>=1100)
  const [left,setLeft]=useState<'before'|'base'|'ours'|'theirs'>('before'),[draft,setDraft]=useState<string|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState<unknown>(null)
  const file=query.data?.files.find(f=>f.path===selected)??query.data?.files[0]
  const editable=!!resolutionId&&!!onSave&&!file?.binary&&!file?.truncated&&(file?.after?.length??0)<=200000
  const markConflicts=(value:string)=>{
    const decorations:editor.IModelDeltaDecoration[]=[]
    let side:'ours'|'theirs'|null=null
    value.split('\n').forEach((line,index)=>{
      const marker=/^(<{7}|={7}|>{7})/.test(line)
      if(line.startsWith('<<<<<<<'))side='ours'
      else if(line.startsWith('======='))side='theirs'
      if(marker||side)decorations.push({range:{startLineNumber:index+1,startColumn:1,endLineNumber:index+1,endColumn:1},options:{isWholeLine:true,className:marker?'code-conflict-marker':side==='ours'?'code-conflict-ours':'code-conflict-theirs',linesDecorationsClassName:'code-conflict-line'}})
      if(line.startsWith('>>>>>>>'))side=null
    })
    return decorations
  }
  const updateDecorations=()=>{
    const instance=diff.current;if(!instance)return
    const model=instance.getModifiedEditor().getModel();if(!model)return
    // This collection belongs to the current editor/model and is disposed with it.
    if(decorations.current)decorations.current.set(markConflicts(model.getValue()))
    else decorations.current=instance.getModifiedEditor().createDecorationsCollection(markConflicts(model.getValue()))
  }
  const decorations=useRef<editor.IEditorDecorationsCollection|null>(null)
  const changeFile=(path:string)=>{
    if(draft!==null)return
    setSelected(path);setLeft('before');setDraft(null)
  }
  const save=async()=>{
    if(!file||draft===null||!onSave||!query.data)return
    setSaving(true);setError(null)
    try{await onSave(file.path,draft,query.data.fingerprint);setDraft(null);onClose()}catch(e){setError(e)}finally{setSaving(false)}
  }
  return <DialogShell open onOpenChange={open=>{if(!open&&!saving)onClose()}} dirty={draft!==null} ariaLabel={resolutionId?'冲突代码对比':'代码变更对比'} width={full?100000:1180} testId="code-review-dialog">
    <OverlayHeader title={resolutionId?'冲突代码对比':'代码变更对比'} meta={file?.path} actions={<Button onClick={()=>setFull(!full)}>{full?'收起全屏':'全屏查看'}</Button>}/>
    <div className={`code-review-workspace ${full?'is-full':''}`}>
      {query.isLoading?<LoadingBlock rows={6}/>:query.isError?<ErrorState title="无法读取完整文件" message={errorMessage(query.error)} onRetry={()=>void query.refetch()}/>:<>
        <div className="code-review-toolbar">
          <Select aria-label="查看改动文件" value={file?.path} disabled={draft!==null} onChange={changeFile} options={query.data?.files.map(f=>({value:f.path,label:`${f.conflict?'冲突 · ':''}${f.path}${f.status==='added'?' · 新增':f.status==='deleted'?' · 删除':''}`}))}/>
          {resolutionId&&<Select aria-label="对比基准" value={left} onChange={setLeft} options={[{value:'before',label:'合入前内容'},{value:'ours',label:'目标分支内容'},{value:'theirs',label:'来源分支内容'},{value:'base',label:'共同基线'}]}/>}
          <label><Switch checked={sideBySide} onChange={setSideBySide} size="small"/>并排对比</label><label><Switch checked={wrap} onChange={setWrap} size="small"/>自动换行</label>
          <Button disabled={!file} onClick={()=>diff.current?.goToDiff('previous')}>上一处改动</Button><Button disabled={!file} onClick={()=>diff.current?.goToDiff('next')}>下一处改动</Button>
        </div>
        <div className="code-review-legend"><span className="is-removed">− 删除内容</span><span className="is-added">+ 新增内容</span>{resolutionId&&<><span className="is-ours">目标分支冲突</span><span className="is-theirs">来源分支冲突</span></>}</div>
        {error&&<Alert type="error" showIcon message={errorMessage(error)}/>}
        {query.data?.truncated&&<Alert type="warning" showIcon message="部分文件超过预览上限，请在本机检查完整内容后审查。"/>}
        {!file?<p>当前没有文件改动。</p>:file.binary?<p>此文件为二进制内容，请在本机对应的应用中检查。</p>:<>
          <div className="code-review-columns"><span>{left==='base'?'共同基线':left==='theirs'?'来源分支':left==='ours'?'目标分支':'变更前'}</span><span>{resolutionId?'解决结果':'变更后'}{file.conflict?' · 存在冲突':''}</span></div>
          <div className="code-review-editor">
            <DiffEditor key={`${file.path}:${left}`} height="100%" language={language(file.path)} original={(left==='before'?file.before:file[left])??''} modified={file.after??''} theme={`projectos-${theme}`} loading={<LoadingBlock rows={6}/>} keepCurrentOriginalModel keepCurrentModifiedModel
              options={{readOnly:!editable,originalEditable:false,renderSideBySide:sideBySide,useInlineViewWhenSpaceIsLimited:false,wordWrap:wrap?'on':'off',diffWordWrap:wrap?'on':'off',fontSize:14,lineHeight:22,minimap:{enabled:false},automaticLayout:true,scrollBeyondLastLine:false,renderOverviewRuler:false,overviewRulerLanes:0,renderValidationDecorations:'off',renderIndicators:true,ignoreTrimWhitespace:false,contextmenu:false,accessibilitySupport:'on',originalAriaLabel:'变更前代码',modifiedAriaLabel:resolutionId?'冲突解决代码':'变更后代码',padding:{top:12},scrollbar:{verticalScrollbarSize:12,horizontalScrollbarSize:12}}}
              onMount={instance=>{diff.current=instance;const owned=instance.getModel();instance.onDidDispose(()=>queueMicrotask(()=>{owned?.original.dispose();owned?.modified.dispose()}));instance.getOriginalEditor().updateOptions({ariaLabel:'变更前代码'});instance.getModifiedEditor().updateOptions({ariaLabel:resolutionId?'冲突解决代码':'变更后代码'});decorations.current=null;updateDecorations();instance.getModifiedEditor().onDidChangeModelContent(()=>{if(editable){const value=instance.getModifiedEditor().getValue();setDraft(value===(file.after??'')?null:value)}updateDecorations()})}}/>
          </div>
        </>}
        <div className="code-review-actions">{draft!==null&&<Button onClick={()=>{diff.current?.getModifiedEditor().setValue(file?.after??'');setDraft(null)}} disabled={saving}>撤销未保存编辑</Button>}{editable&&<Button type="primary" disabled={draft===null} loading={saving} onClick={()=>void save()}>申请保存解决结果</Button>}<Button onClick={onClose} disabled={saving||draft!==null}>返回审查与审批</Button></div>
      </>}
    </div>
  </DialogShell>
}

export function CodeDiffPreview({diff,onExpand}:{diff:string;onExpand:()=>void}) {
  const lines=diff.split('\n')
  return <div className="code-diff-preview"><div className="rq-review-heading"><div className="code-review-legend"><span className="is-removed">− 删除</span><span className="is-added">+ 新增</span></div><Button onClick={onExpand}>展开代码对比</Button></div><pre tabIndex={0} aria-label="代码改动高亮预览">{lines.slice(0,120).map((line,index)=><span key={index} className={line.startsWith('+++')||line.startsWith('---')?'is-meta':line.startsWith('+')?'is-add':line.startsWith('-')?'is-remove':line.startsWith('@@')?'is-hunk':'is-context'}>{line||' '}</span>)}</pre>{lines.length>120&&<Button type="link" onClick={onExpand}>查看全部改动</Button>}</div>
}
