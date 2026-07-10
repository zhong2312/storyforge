# 可介入的透明生成管线 · 开发设计文档

> 状态:Claude 起草(2026-07-10),待作者确认 → Codex 实施。
> 定位:这不是一个孤立新功能,而是**把项目现有一切 AI 生成,统一收口到一个"节点链"执行模型**。分阶段生成、提示词发送前可编辑、以及未来 agent 的"每节点可介入",都是这一个抽象的三种形态。
> 前置必读:`CLAUDE.md`(三注册表铁律)、`docs/AI-COPILOT-DESIGN.md`(§2.2 检测环软硬、§2.3 与一致性关系、AgentRunner)、本文件不覆盖数据红线。

---

## 0. 一句话定位

把每一次 AI 生成,从"**黑箱一次性自由发挥**",改造成"**由若干可介入节点组成的透明管线**"。每个节点暴露两个介入点:① 送进模型前的**拼接后提示词**可看、可改;② 模型产出后可**预览、编辑、采纳**。节点可串联:上一节点已确认的产物,锚定下一节点。

- **一次性生成** = 只有 1 个节点的管线(现状)。
- **分阶段生成(如章纲工坊)** = N 个节点的管线。
- **未来 agent** = 动态编排节点顺序的编排器,但每个节点仍暴露同样的介入点。

**一个抽象,三头受益:做出"透明管线节点",分阶段生成 + 提示词可编辑 + agent 每节点可调,全部掉出来。**

---

## 1. 问题(为什么做)

1. **一次性生成 = 最不可预期。** 现在生成章纲/正文是一次把"提示词 + 大量上游字段"拼成一坨发给模型,模型要同时顾动机/情节/伏笔/节奏/文采,样样浅 → 结果薄、逻辑松、机械降神、原地打转(社区实测反馈)。
2. **拼接是黑箱。** 用户看不到"最终到底把哪些字段、拼成什么样"发给了模型,更改不了。想要的效果调不出来,只能反复重生成撞运气。
3. **产品魂没做透。** README 已宣称"不是黑箱、提示词可见可改、所有输出经预览编辑采纳"。但现在"可见可改"只到**模板**层,没到**拼接后的最终提示词**层;生成也没分阶段。这条魂只做了一半。

**市场定位价值**:别人的 AI 写作工具是"黑箱、一次性、祈祷它好";把这条管线做出来,故事熔炉是"**玻璃箱、分阶段、每个节点作者都握着方向盘**"。差异化不在"模型质量"(卷不过大厂),而在"**让作者在 AI 的每一步都能看输入、调输入、审输出**"——这个别人抄不走,它要的是本项目结构化数据 + 注册表 + 透明管线的地基。

---

## 2. 现状(代码事实 · 已有一大半,不是从零)

> 结论:这个抽象的底座**已经搭好一大半**,本设计主要是"泛化 + 补最后一段",不是新造子系统。

| 能力 | 现状(已核代码) | 缺口 |
|---|---|---|
| 上下文装配 | `assembleContext()`(`CONTEXT_SOURCES`)按需拉取、分层、预算裁剪 | — |
| 提示词拼接 | 各 adapter(`buildChapterContentPrompt` / `outline-adapter` 等)把 assembleContext 产物 + 模板拼成完整 `messages` | — |
| 拼接内容透明 | `analyzeContextSegments` 已把拼好的 messages 拆成带标签的段(System Prompt / 章节大纲 / 各上游字段 / User Prompt)喂 `ContextBudgetBar`(见 `ChapterEditor.tsx` ~L422) | 段落**可见**,但最终整块**不可编辑**、发送前无预览环节 |
| 模板临时改 | `PromptRunPanel`("调参浮窗")可调参 + "高级:临时改 Prompt 文字",`systemOverride`/`userOverride` 运行时覆盖不写回模板;`outline-adapter` 有 `overrides:{systemPrompt,userPromptTemplate}` | 改的是**模板**,不是**拼接后最终文本** |
| 分阶段生成 | `OutlinePanel` 已是**粗粒度分阶段**:卷纲(`outline.volume`)与章纲(`outline.chapter`)是两次独立 `ai.start`,各自 `assembleContext → messages → 流式` | 章**内**仍是一次性;没有"现状→动机→碰撞→场景卡"的细粒度阶段 + 阶段间锚定 + 阶段产物存储 |
| 采纳落库 | `adopt()` + `FIELD_REGISTRY` + `ADOPTION_SCHEMAS` 结构化写回 + 确认 | — |
| 软硬闸门 | `held-items`(CONSISTENCY-1)已是第一块确定性校验器 | 尚未接入"生成节点采纳前"这一环 |

**一句话现状**:装配、拼接、透明分段、模板覆盖、粗分阶段、采纳、第一块硬校验——**全有**。缺的是把它们抽象成"节点",并补上"最终提示词可编辑"和"章内细分阶段"这两段。

---

## 3. 核心抽象:透明管线节点(GenerationNode)

新增一个**执行模型层**(不是新数据表,是一层薄封装/运行时结构),把"一次生成"标准化为一个节点:

```
GenerationNode {
  id / kind                       // 如 'outline.chapter.motivation'
  assembleInput(ctx) → messages   // 复用 assembleContext + adapter,产出拼接后的完整 messages
  editableInput?: boolean         // 该节点是否允许"发送前编辑最终提示词"
  run(messages) → stream          // 复用 ai.start / streamChat
  gate?(output) → GateResult      // 可选:采纳前过确定性校验(held-items / 认知账本 / canon)
  adopt(confirmedOutput)          // 复用 adopt(),写回走注册表
  produces?: ArtifactKey          // 该节点产物的 key,供后续节点 assembleInput 锚定引用
}

Pipeline = GenerationNode[]       // 静态数组(工坊)或由编排器动态给出(agent)
```

**三条铁律(对应 CLAUDE.md)**:
- `assembleInput` **只能**经 `assembleContext`(读),不许在节点里手挑字段拼接。
- `adopt` **只能**经 `FIELD_REGISTRY/ADOPTION_SCHEMAS`(写),不许裸 `db.xxx`。
- 节点产物若要落库/参与生命周期,**先去 `PROJECT_TABLES` 登记**。

**这一层是泛化,不是并行系统**:现有 `ChapterEditor.handleGenerate` / `OutlinePanel` 的生成流,本质就是"1 个节点";本设计是把它们重构成"走 GenerationNode",而不是另写一套。

---

## 4. 方案分解(三期递进,从便宜到旗舰到收口)

### 4.1 PIPELINE-1 · 发送前提示词预览 + 编辑(首刀,最便宜,立刻兑现"透明")

**做什么**:在现有生成流"messages 已拼好 → `ai.start(messages)`"之间,插一个**可选**的预览/编辑环节。用户可展开看"拼接后的最终提示词整块",直接改,改完发编辑后的版本(一次性覆盖,不写回模板/字段)。

**怎么做**:
- 现有 adapter 已产出 `messages`(system+user)。新增一个轻组件 `PromptPreviewGate`:入参 `messages`,渲染 system/user 两块可编辑 `<textarea>`(默认折叠,`ContextBudgetBar` 已有的分段标注可复用作只读导航)。
- 生成入口(ChapterEditor / OutlinePanel / 各面板)在 `ai.start` 前,若用户开了"透明模式/高级",先弹 `PromptPreviewGate`;确认后 `ai.start(editedMessages ?? messages)`。
- 复用 `PromptRunPanel` 的"运行时覆盖、不写回"语义;这里覆盖的是**最终 messages**,不是模板。

**关键点**:
- **默认关闭**,渐进式披露(高级开关 / 折叠面板)。绝不把一大坨拼接文本糊到每个普通用户脸上。
- 覆盖是**一次性**,不污染模板与字段。
- 复用现有 `analyzeContextSegments` 做段落导航,让用户知道"这段是世界观、这段是伏笔",改起来有方向。

**效果**:立刻兑现 README 承诺的"提示词可见可改"到**最终拼接层**;power-user 能精确调效果;顺手把"节点"抽象验证了(它就是单节点管线加了 editableInput)。

### 4.2 PIPELINE-2 · 分阶段章纲工坊(旗舰,把一次性拆成节点链)

**做什么**:把"生成一章章纲"从一次性,改造成一条 5 节点管线,每节点窄而深、用户确认、锚定下一节点。节点提示词内容参考社区「元写作 Skill」方法论(见 §6)。

**节点链(每个都是 GenerationNode)**:
```
① 现状扫描   读账本:谁该出场/伏笔该回收/角色现在知道什么(assembleContext 读伏笔/状态/角色/章序)
      ↓ 产物锚定下一节点
② 动机推演   每个在场角色"此刻最想要什么"(不是"这章发生什么")
      ↓
③ 碰撞预演   2-3 人动机相撞 → 反应链(≥3步)→ 不可逆结果
      ↓
④ 质检闸门   反套路检查 + 认知边界/持有物用确定性校验硬查;不过打回③重来
      ↓
⑤ 落场景卡   汇总为结构化章纲(场景卡 + 不可写清单),adopt 落库
```

**怎么做**:
- 每节点一个 adapter(prompt),内容填 §6 方法论。`assembleInput` 经 assembleContext,并把**前序节点已确认产物**作为一个新的 CONTEXT_SOURCE 注入(→ 先去 `CONTEXT_SOURCES` 登记 `pipelineArtifact` 源)。
- 中间产物 v1 可**先做成会话内瞬态**(工坊面板 state),不落库;确认要持久化再走 `PROJECT_TABLES` 新增一张轻表(`outlinePipelineArtifacts`),按注册表接生命周期。
- UI:一个"章纲工坊"面板 = 分步 stepper,每步显示节点产物、可编辑、确认后触发下一步;每步都可选走 PIPELINE-1 的"看/改提示词"。
- **默认仍保留"一键快速生成章纲"**(现状,一次性);工坊是"深度模式",opt-in。

**关键点**:
- **两档并存**:快速(一次性,便宜)/ 工坊(分阶段,深、贵)。别逼所有用户为每章走 5 步。
- **成本**:分阶段 = 每章多次调用 = 更烧 token;UI 要显式提示,让用户知情选择。
- **不可写清单 / 认知边界**产物落库后,供正文生成期的一致性校验复用(→ 接一致性工程化)。

### 4.3 PIPELINE-3 · agent 节点化接口(收口,接 AgentRunner)

**做什么**:让 `AI-COPILOT-DESIGN` 的 AgentRunner 直接把 GenerationNode 当执行单元。agent 编排器动态决定"下一个节点是什么",但每个节点**照样**暴露 editableInput + gate + adopt 确认。

**怎么做**:AgentRunner 的每一步 = 实例化并跑一个 GenerationNode;前台对话副驾在节点的 gate/adopt 处插入"用户确认"(= AI-COPILOT-DESIGN §"前台用户驱动写入确认"安全线的落地)。

**关键点**:这一步基本"免费"——因为节点本就带 editableInput/gate/adopt,agent 只是换了种方式串节点。**做了 PIPELINE-1/2,PIPELINE-3 主要是把 AgentRunner 的 step 对齐到 GenerationNode 接口。**

---

## 5. 是哪些功能的一部分(与 agent / 一致性 / Skill 的关系)

**它不是独立新功能,是把三条既有线缝在一起的执行模型层:**

- **是 agent 工程的执行模型**:GenerationNode 就是 `AI-COPILOT-DESIGN` AgentRunner 的执行单元;"每节点可介入"是这个抽象自带的,agent 不用单独设计。本文件是 AI-COPILOT-DESIGN 的**执行层补充**。
- **是软硬结合落地的地方**:每个节点 = 软(AI 生成)→ 硬(gate 确定性校验)→ 闸门(用户确认采纳)。`AI-COPILOT-DESIGN` §2.2「检测环:确定性主干」的"确定性尺子",就插在节点的 `gate` 上;`held-items` / 认知账本 / canon validator 是被 gate 复用的基础设施。
- **消费 Skill 方法论**:PIPELINE-2 各节点的 prompt 内容,来自社区「元写作 Skill」的方法论(动机优先、情绪遗产表、碰撞反应链、反套路检查、压力测试、场景卡、不可写清单、认知边界"误以为"、写作技法库)。方法论 = 灌进节点的"水";管线 = "管子"。

> 换句话说:agent 是"跑管线的编排器",一致性是"每个节点要过的硬闸门",Skill 是"每个节点该怎么想的内容"。本设计是把这三者**统一到 GenerationNode 这一个接口上**。

---

## 6. 附:PIPELINE-2 节点方法论要点(来自社区「元写作 Skill」,填进各节点 prompt)

- **动机优先**:先问"每个人此刻最想要什么",不问"这章发生什么事件"。行动必须从动机自然推导 + 在认知边界内 + 符合性格底色。
- **碰撞出情节**:情节是人物动机相撞出来的,不是编的。反应链 ≥3 步(A做X→B理解为Y→B做Z→A误解为W),产出不可逆结果;优先"价值错位"冲突(双方都没错但不得不对立)。
- **反套路检查**(生成前闸门):反派降智 / 主角开天眼 / 巧合推进 / 轻易胜利 / 强行冲突 / 信息差滥用 / 工具人 / 时间冻结——命中即打回。
- **认知边界**(知道/不知道/**误以为**):每角色每章的知识状态,防"开天眼"、防认知 OOC。"误以为"是剧情引擎,现有事实库(真/假)缺这一维。
- **不可写清单**:每章/每场景显式列"绝对不能写"(角色还不知道 / 节奏前置 / 类型不符),供正文期硬回查。
- **写作技法库**(治破折号八股/无意义排比):冲突三维度/三层体系、欲扬先抑、信息差、代价与奖赏、反向切入("现在最不该发生什么")、张弛有度、长短句、章末钩子、详略取舍。

> 注:方法论**照抄它的"文本文件 + LLM 自评 + 人确认"是不够的**——本项目的增量,是把可校验的部分(认知边界/不可写清单/持有物)放到节点 `gate` 上用**确定性代码**判,而非只让 LLM 自评。这才是护城河。

---

## 7. 效果与提升(给项目带来多大)

- **生成质量可预期**:一次性(最不可预期)→ 分阶段(每步窄而深 + 早确认早纠偏)。直接治社区吐槽的"薄/机械降神/原地打转"。
- **透明可控做透**:把 README 的产品魂从"模板可改"推进到"整条管线、每个节点、输入输出全可介入"。这是**市场差异化的核心卖点**。
- **一次投入,三处复用**:同一个 GenerationNode 抽象,服务分阶段生成 + 提示词编辑 + agent。避免为三件事写三套。
- **为 agent 铺路**:PIPELINE-1/2 本质是 agent 每节点交互的原型,提前把最难的 UX(节点介入)验证掉,agent 落地风险大降。

---

## 8. 注意点与关键点(红线 / 别做砸)

1. **绝不另起炉灶(最高优先)**:GenerationNode 必须是现有生成流的**泛化**,`assembleInput` 走 `assembleContext`、`adopt` 走 `FIELD_REGISTRY/ADOPTION_SCHEMAS`、新表进 `PROJECT_TABLES`。违反 = 新屎山,直接打回。过 `check:architecture`。
2. **默认路径必须还是"一键生成"**:分阶段 / 提示词编辑是**渐进式深度**(高级开关 / 工坊模式),opt-in。普通用户体验不变。
3. **成本透明**:分阶段多次调用更烧 token,UI 明示;给"快速 vs 工坊"两档选择。
4. **提示词编辑是 power-user 功能**:折叠、默认关;覆盖是一次性、不写回模板/字段。
5. **中间产物落库要克制**:v1 优先瞬态(会话 state);确需持久化再进 `PROJECT_TABLES`,别一上来就加表。
6. **gate 只接确定性校验**:节点闸门里放 `held-items` / 认知账本 / canon 这类**确定性**判决;LLM 自评的"反套路/压力测试"是软建议,归 ReviewPanel 或作为 advisory,别当硬闸门。
7. **数据红线**:若 PIPELINE-2 新增 `outlinePipelineArtifacts` 表 → 迁移测试 + 导出/导入往返;生产不自动清库。

---

## 9. 开发步骤(建议顺序)

1. **抽象先行**:定义 `GenerationNode` 接口 + 一个 `runNode()` 运行器(封装 assembleInput→[可选 PromptPreviewGate]→run→[可选 gate]→adopt)。先用它**重构一个现有生成**(如 `outline.chapter`),证明"泛化不改变现有行为"(回归测试全绿)。
2. **PIPELINE-1**:实现 `PromptPreviewGate`,在 1-2 个生成入口接上"发送前预览/编辑"(默认关)。
3. **PIPELINE-2**:实现 5 节点章纲工坊(先瞬态产物);各节点 adapter 填 §6 方法论;质检节点接 `held-items`(+ 认知账本若已就绪)。保留一键快速生成。
4. **PIPELINE-3**:AgentRunner step 对齐 GenerationNode 接口(可等 agent 工程启动时做)。

每一步都是独立可交付、可合并的,不必等下一步。

---

## 10. 测试

- **回归(重构不改行为)**:重构 `outline.chapter` 走 GenerationNode 后,现有 outline 相关回归测试全绿(证明泛化无副作用)。
- **PIPELINE-1**:`R-PIPELINE1` — 不开高级时行为与现状一致;开高级并编辑最终提示词 → `ai.start` 收到的是编辑后 messages;覆盖不写回模板/字段(重开面板恢复原样)。
- **PIPELINE-2**:`R-PIPELINE2` — ① 节点顺序不可跳级(未确认动机不进碰撞);② 后节点 assembleInput 确实包含前节点已确认产物;③ 质检节点对"认知边界外/重复获得"能确定性打回;④ 一键快速生成路径不受影响;⑤ 若加表:迁移 + 导出/导入往返(`R-PIPELINE2-migration`)。
- **PIPELINE-3**:`R-PIPELINE3` — AgentRunner 跑一个节点时,gate/adopt 的用户确认关卡生效(前台不自主写库)。
- **闸门**:`tsc` / `build` / `vitest` / `check:architecture` / `check:required-tables` / `check:ai-manual` 全绿。

---

## 11. 完成判据(Definition of Done)

- **可用**:章纲工坊端到端走得通(用户真能分阶段产出一份比一次性更厚更严的章纲);提示词发送前可看可改真的影响生成。
- **无重复 / 旧入口收敛**:一次性生成重构为"1 节点管线",不新旧两套并存;工坊是同一抽象的多节点形态。
- **走注册表**:读经 `assembleContext`、写经 `adopt`、新表进 `PROJECT_TABLES`,无裸写。
- **半成品不外露**:未完成的节点/工坊标"实验性"并默认隐藏。
- **验证证据**:上述测试 + 闸门全绿,commit 写清证据。

---

## 附:与既有文档的关系(交叉引用)

- 本文件 = `docs/AI-COPILOT-DESIGN.md` 的**执行层补充**(GenerationNode = AgentRunner 执行单元;gate = §2.2 检测环的插点)。
- 一致性侧:节点 `gate` 复用 `held-items`(CONSISTENCY-1)及后续 `认知账本` / `canon validator`(见收敛路线)。
- ⚠️ **文档缺口提醒**:软硬结合的**完整收敛路线(问题/现状/思路/方案/可行性)**目前主要在 WPS 文档库《StoryForge_收敛路线_一页纸》+ VISION v3,仓库内只有 ROADMAP 一行北极星 + 指针。Codex 看不到 WPS。建议单独把收敛路线搬进仓库(如 `docs/CONSISTENCY-ENGINEERING-ROUTE.md`),否则接手者拿不到全貌。
