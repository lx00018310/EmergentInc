# Loop v0.2

A. Environment Update  
B. Build Local Views  
C. Wake Eventful Pixels  
D. Seeded Shuffle Decision Order  
E. LLM Decisions  
F. Validate Actions  
G. Apply Actions  
H. Evidence Validation  
I. Resource Settlement  
J. Maintenance & Death  
K. Learning  
L. Persist  
M. Metrics

## Wake 条件

仅当 Pixel 有：
- current Problem
- visible offer
- new bid
- transfer proposal
- new evidence
- self-trigger
- local environment event

才调用 LLM。

## Spawn 冲突

同一空格冲突时使用本轮 seeded lottery。
禁止坐标优先。
