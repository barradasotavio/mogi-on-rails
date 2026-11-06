# Finished mogi without a close action

A mogi is finished when it has 12 established counted races; before that it is in progress, and discarding a race returns it to in progress. An explicit close/reopen action was considered and rejected: it would force reopening the mogi to correct data and says nothing the race count doesn't already say.

**Consequences:** a finished mogi never rereads its images, so Storage may delete their bytes while every capture record, answer and result stays identical.
