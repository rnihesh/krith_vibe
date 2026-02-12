module BinaryTree where

data Tree a = Empty | Node a (Tree a) (Tree a) deriving (Show)

insert :: (Ord a) => a -> Tree a -> Tree a
insert x Empty = Node x Empty Empty
insert x (Node val left right)
  | x < val   = Node val (insert x left) right
  | x > val   = Node val left (insert x right)
  | otherwise  = Node val left right

search :: (Ord a) => a -> Tree a -> Bool
search _ Empty = False
search x (Node val left right)
  | x == val  = True
  | x < val   = search x left
  | otherwise  = search x right

inOrder :: Tree a -> [a]
inOrder Empty = []
inOrder (Node val left right) = inOrder left ++ [val] ++ inOrder right

fromList :: (Ord a) => [a] -> Tree a
fromList = foldr insert Empty

main :: IO ()
main = do
  let tree = fromList [5, 3, 7, 1, 4, 6, 8]
  putStrLn $ "In-order: " ++ show (inOrder tree)
  putStrLn $ "Search 4: " ++ show (search 4 tree)
  putStrLn $ "Search 9: " ++ show (search 9 tree)
